import { Capacitor, registerPlugin } from '@capacitor/core';
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

// ---------------------------------------------------------------------------
// Fresh location for shop-visit verification
// ---------------------------------------------------------------------------

// Native Android plugin bundled in the app (MainActivity registers it). Returns a brand-new fix and
// whether Android marks it as coming from a mock-location provider. Missing in older builds and on web.
const LocationIntegrity = registerPlugin('LocationIntegrity');

const VISIT_LOCATION_MESSAGES = {
  permission_denied: {
    native: 'Location permission is off for LineCart. Allow it in Android Settings → Apps → LineCart → Permissions → Location (choose "Allow only while using the app" and turn on "Use precise location"), then try again.',
    web: 'Location permission is blocked for this site. Allow location in your browser settings, then try again.'
  },
  precise_required: 'LineCart only has approximate location, which is accurate to about 2 km. Shop visits need precise location: open Android Settings → Apps → LineCart → Permissions → Location and turn on "Use precise location", then try again.',
  services_disabled: 'Your phone\'s Location (GPS) is turned off. Turn it on in Quick Settings, then try again.',
  timeout: 'No GPS fix yet. Move near a door or window (or outside) with Location on, then try again.',
  unavailable: 'Your location is unavailable right now. Check that Location is on and try again.',
  insecure: 'Location needs a secure (HTTPS) connection. Open LineCart over HTTPS and try again.'
};

const PLUGIN_CODE_REASONS = {
  PERMISSION_DENIED: 'permission_denied',
  PRECISE_REQUIRED: 'precise_required',
  SERVICES_DISABLED: 'services_disabled',
  TIMEOUT: 'timeout',
  UNAVAILABLE: 'unavailable'
};

const isPluginMissing = (err) =>
  err?.code === 'UNIMPLEMENTED' || /not implemented|does not have an implementation|plugin is not/i.test(String(err?.message || ''));

function visitFail(reason, isNative) {
  return {
    ok: false,
    reason,
    message:
      reason === 'permission_denied'
        ? VISIT_LOCATION_MESSAGES.permission_denied[isNative ? 'native' : 'web']
        : VISIT_LOCATION_MESSAGES[reason] || VISIT_LOCATION_MESSAGES.unavailable
  };
}

/**
 * Core of getFreshVisitLocation with its platform dependencies passed in (so it can be tested without a device).
 * deps: { isNative, platform, geolocation (Capacitor Geolocation), integrity (LocationIntegrity plugin),
 *         webPosition(options) }
 */
export async function getFreshVisitLocationWith(deps, { timeoutMs = 20000, desiredAccuracyM = 30 } = {}) {
  const { isNative, platform } = deps;
  const fail = (reason) => visitFail(reason, isNative);

  try {
    if (isNative) {
      // Visits need PRECISE location (the server checks ±30 m by default). Ask for it, and tell the agent
      // exactly what to change when only approximate location is allowed.
      let perms = await deps.geolocation.checkPermissions();
      if (perms?.location !== 'granted') {
        perms = await deps.geolocation.requestPermissions({ permissions: ['location'] });
      }
      if (perms?.location !== 'granted') {
        return fail(perms?.coarseLocation === 'granted' ? 'precise_required' : 'permission_denied');
      }

      // 1. Bundled native plugin: fused provider (GPS + Wi-Fi + mobile network, same engine as customer
      //    "Fetch Location"), fresh fixes only, waits for desiredAccuracyM, reports Android's mock flag.
      try {
        const r = await deps.integrity.getFreshLocation({ timeoutMs, desiredAccuracyM });
        if (Number.isFinite(Number(r?.latitude)) && Number.isFinite(Number(r?.longitude))) {
          const accuracy = Number(r.accuracy);
          return {
            ok: true,
            latitude: Number(r.latitude),
            longitude: Number(r.longitude),
            accuracy,
            fixTimestamp: Number(r.time) || Date.now(),
            mockLocation: r.isMock === true || r.anyMock === true ? 'yes' : r.isMock === false ? 'no' : 'unknown',
            meetsAccuracy: typeof r.meetsAccuracy === 'boolean' ? r.meetsAccuracy : Number.isFinite(accuracy) && accuracy <= desiredAccuracyM,
            source: r.source || 'plugin',
            waitedMs: Number(r.waitedMs) || null,
            platform
          };
        }
        return fail('unavailable');
      } catch (pluginErr) {
        if (!isPluginMissing(pluginErr)) {
          return fail(PLUGIN_CODE_REASONS[pluginErr?.code] || classifyLocationError(pluginErr, true).reason);
        }
        // Older app build without the plugin: fall through to Capacitor Geolocation
      }

      // 2. Fallback (plugin missing): Capacitor Geolocation, fresh high-accuracy fix only (maximumAge 0)
      const pos = await deps.geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0, enableLocationFallback: true });
      const accuracy = Number(pos.coords.accuracy);
      return {
        ok: true,
        latitude: Number(pos.coords.latitude),
        longitude: Number(pos.coords.longitude),
        accuracy,
        fixTimestamp: Number(pos.timestamp) || Date.now(),
        mockLocation: 'unknown',
        meetsAccuracy: Number.isFinite(accuracy) && accuracy <= desiredAccuracyM,
        source: 'capacitor-geolocation',
        waitedMs: null,
        platform
      };
    }

    if (typeof window !== 'undefined' && window.isSecureContext === false) return fail('insecure');
    const pos = await deps.webPosition({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 });
    const accuracy = Number(pos.coords.accuracy);
    return {
      ok: true,
      latitude: Number(pos.coords.latitude),
      longitude: Number(pos.coords.longitude),
      accuracy,
      fixTimestamp: Number(pos.timestamp) || Date.now(),
      mockLocation: 'unknown',
      meetsAccuracy: Number.isFinite(accuracy) && accuracy <= desiredAccuracyM,
      source: 'browser',
      waitedMs: null,
      platform
    };
  } catch (err) {
    return fail(classifyLocationError(err, isNative).reason);
  }
}

/**
 * Get a FRESH device location for visit verification. Never returns a cached position.
 * Resolves to { ok: true, latitude, longitude, accuracy, fixTimestamp, mockLocation, meetsAccuracy, source, platform }
 * or { ok: false, reason, message }. reason: permission_denied | precise_required | services_disabled | timeout |
 * unavailable | insecure. A fix that misses desiredAccuracyM is still returned (meetsAccuracy=false): the server
 * applies the accuracy rule and records the attempt.
 */
export async function getFreshVisitLocation({ timeoutMs = 20000, desiredAccuracyM = 30 } = {}) {
  const isNative =
    typeof window !== 'undefined' &&
    typeof Capacitor?.isNativePlatform === 'function' &&
    Capacitor.isNativePlatform();
  return getFreshVisitLocationWith(
    {
      isNative,
      platform: isNative ? Capacitor.getPlatform?.() || 'android' : 'web',
      geolocation: Geolocation,
      integrity: LocationIntegrity,
      webPosition: getWebPosition
    },
    { timeoutMs, desiredAccuracyM }
  );
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
