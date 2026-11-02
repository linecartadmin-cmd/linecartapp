import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

/**
 * Classify a native Capacitor or Web Geolocation error into a structured reason
 * and a clear, actionable message for Field Sales Agents.
 */
export function classifyLocationError(err, isNative = false) {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? err ?? '');
  const combined = `${code} ${msg}`.toLowerCase();

  // 1. Device Location / GPS Services turned off
  if (
    code === 'OS-PLUG-GLOC-0007' ||
    code === 'OS-PLUG-GLOC-0008' ||
    code === 'OS-PLUG-GLOC-0009' ||
    code === 'OS-PLUG-GLOC-0016' ||
    code === 'OS-PLUG-GLOC-0017' ||
    /location services.*not enabled|location.*disabled|enable location.*denied|location settings error|network and location turned off/i.test(
      combined
    )
  ) {
    return {
      reason: 'services_disabled',
      message:
        'Device Location / GPS is turned off. Please turn on Location in your phone’s Quick Settings, then tap Retry — or tap the map to place the shop pin manually.'
    };
  }

  // 2. Permission denied (or missing manifest permission)
  if (
    code === '1' ||
    code === 'OS-PLUG-GLOC-0003' ||
    code === 'OS-PLUG-GLOC-0018' ||
    /permission.*denied|user denied geolocation|not granted|permissions are not declared/i.test(combined)
  ) {
    return {
      reason: 'permission_denied',
      message: isNative
        ? 'Location permission was denied. Allow Location access in Android Settings → Apps → LineCart Wholesale → Permissions, then tap Retry — or tap the map to place the shop pin manually.'
        : 'Location permission was denied. Allow Location access in your browser’s site permissions, then tap Retry — or tap the map to place the shop pin manually.'
    };
  }

  // 3. Timeout waiting for GPS fix
  if (
    code === '3' ||
    code === 'OS-PLUG-GLOC-0010' ||
    /timeout|timed out|could not obtain location in time/i.test(combined)
  ) {
    return {
      reason: 'timeout',
      message:
        'Timed out waiting for a GPS fix. Move near an open doorway or clear sky and tap Retry — or tap the map to place the shop pin manually.'
    };
  }

  // 4. General unavailable / Play Services / hardware unavailable
  return {
    reason: 'unavailable',
    message:
      'Current GPS location is unavailable right now. Check your GPS or mobile network signal and tap Retry — or tap the map to place the shop pin manually.'
  };
}

function getWebPosition(options) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const err = new Error('Geolocation is not supported on this device or browser.');
      err.code = 2;
      reject(err);
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * One-shot foreground location request (never tracks continuously and never requests background location).
 * Uses @capacitor/geolocation on native Android/iOS and navigator.geolocation on Web.
 */
export async function fetchCurrentDeviceLocation() {
  const isNative =
    typeof window !== 'undefined' &&
    typeof Capacitor?.isNativePlatform === 'function' &&
    Capacitor.isNativePlatform();

  try {
    let pos = null;

    if (isNative) {
      // 1. Check whether system Location Services are enabled and inspect current permission state
      let perms = await Geolocation.checkPermissions();
      let hasForegroundPerm =
        perms?.location === 'granted' || perms?.coarseLocation === 'granted';

      // 2. Request foreground runtime permission only when user taps the button
      if (!hasForegroundPerm) {
        perms = await Geolocation.requestPermissions({
          permissions: ['location', 'coarseLocation']
        });
        hasForegroundPerm =
          perms?.location === 'granted' || perms?.coarseLocation === 'granted';
      }

      if (!hasForegroundPerm) {
        return {
          ok: false,
          ...classifyLocationError({ code: 'OS-PLUG-GLOC-0003', message: 'Location permission request was denied.' }, true)
        };
      }

      const canUseFine = perms?.location === 'granted';

      try {
        pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: canUseFine,
          timeout: 12000,
          maximumAge: 0,
          enableLocationFallback: true
        });
      } catch (firstErr) {
        const classified = classifyLocationError(firstErr, true);
        // If indoor high-accuracy satellite fix timed out or was unavailable, retry once with coarse/network accuracy
        if (
          canUseFine &&
          (classified.reason === 'timeout' || classified.reason === 'unavailable')
        ) {
          pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: false,
            timeout: 8000,
            maximumAge: 30000,
            enableLocationFallback: true
          });
        } else {
          throw firstErr;
        }
      }
    } else {
      // Web browser flow
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        return {
          ok: false,
          reason: 'unavailable',
          message:
            'Browser geolocation requires a secure HTTPS connection. Please use HTTPS or tap the map to place the shop pin manually.'
        };
      }

      try {
        pos = await getWebPosition({
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0
        });
      } catch (firstErr) {
        const classified = classifyLocationError(firstErr, false);
        if (classified.reason === 'timeout' || classified.reason === 'unavailable') {
          pos = await getWebPosition({
            enableHighAccuracy: false,
            timeout: 8000,
            maximumAge: 30000
          });
        } else {
          throw firstErr;
        }
      }
    }

    const latNum = Number(pos?.coords?.latitude);
    const lonNum = Number(pos?.coords?.longitude);
    const accuracy = Number(pos?.coords?.accuracy || 0);

    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      return {
        ok: false,
        reason: 'unavailable',
        message:
          'Received invalid GPS coordinates from the device. Please tap Retry or tap the map to place the shop pin manually.'
      };
    }

    const latitude = latNum.toFixed(6);
    const longitude = lonNum.toFixed(6);
    const roundedAcc = accuracy > 0 ? Math.round(accuracy) : null;
    const isLowAccuracy = roundedAcc !== null && roundedAcc > 100;

    return {
      ok: true,
      latitude,
      longitude,
      accuracy: roundedAcc,
      lowAccuracy: isLowAccuracy,
      reason: isLowAccuracy ? 'low_accuracy' : 'ok'
    };
  } catch (err) {
    return {
      ok: false,
      ...classifyLocationError(err, isNative)
    };
  }
}

/**
 * Reverse-geocode latitude and longitude into a street address and 6-digit postal pincode.
 * Uses OpenStreetMap Nominatim (zoom=18) with BigDataCloud fallback if Nominatim is unreachable.
 */
export async function reverseGeocodeCoordinates(lat, lon) {
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    return { ok: false, address: '', pincode: '' };
  }

  const isNative =
    typeof window !== 'undefined' &&
    typeof Capacitor?.isNativePlatform === 'function' &&
    Capacitor.isNativePlatform();

  // 1. Primary: OpenStreetMap Nominatim (zoom=18 for building/street level)
  try {
    const headers = {
      Accept: 'application/json',
      'Accept-Language': 'en'
    };
    if (isNative) {
      headers['User-Agent'] = 'LineCartWholesale/1.0 (in.linecart.suite)';
    }
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      latNum
    )}&lon=${encodeURIComponent(lonNum)}&zoom=18&addressdetails=1`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      if (data?.display_name) {
        const rawPin = String(data.address?.postcode || '').replace(/\s+/g, '');
        return {
          ok: true,
          address: String(data.display_name).trim(),
          pincode: rawPin.slice(0, 6)
        };
      }
    }
  } catch {
    // Proceed to fallback geocoder
  }

  // 2. Fallback: BigDataCloud client reverse geocoding (no API key required)
  try {
    const fallbackUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(
      latNum
    )}&longitude=${encodeURIComponent(lonNum)}&localityLanguage=en`;
    const res = await fetch(fallbackUrl, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const parts = [
        data.locality,
        data.city,
        data.principalSubdivision,
        data.postcode,
        data.countryName
      ]
        .map((p) => String(p || '').trim())
        .filter(Boolean);
      const uniqueParts = parts.filter((item, idx) => parts.indexOf(item) === idx);
      if (uniqueParts.length > 0) {
        const rawPin = String(data.postcode || '').replace(/\s+/g, '');
        return {
          ok: true,
          address: uniqueParts.join(', '),
          pincode: rawPin.slice(0, 6)
        };
      }
    }
  } catch {
    // Offline or geocoding unreachable
  }

  return { ok: false, address: '', pincode: '' };
}
