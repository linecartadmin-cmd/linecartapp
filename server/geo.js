/**
 * Geographic helpers for GPS-verified shop visits. Pure functions (unit-tested in tests/geo.test.js).
 */

const EARTH_RADIUS_M = 6371008.8; // mean Earth radius (IUGG)

/** Great-circle distance in metres between two WGS84 points (Haversine). */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Finite number in [-90, 90] / [-180, 180], not the 0,0 "missing" marker. */
export function isValidCoordinate(lat, lng) {
  const la = Number(lat);
  const lo = Number(lng);
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') return false;
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return false;
  if (la === 0 && lo === 0) return false;
  return true;
}

// LineCart operates in India. Registered shop coordinates must fall inside this box.
export const SERVICE_AREA = Object.freeze({ minLat: 6.0, maxLat: 37.5, minLng: 68.0, maxLng: 97.5 });

export function isInServiceArea(lat, lng) {
  const la = Number(lat);
  const lo = Number(lng);
  return la >= SERVICE_AREA.minLat && la <= SERVICE_AREA.maxLat && lo >= SERVICE_AREA.minLng && lo <= SERVICE_AREA.maxLng;
}

/** A shop location usable for verification: valid, not 0,0, inside the service area. */
export function isRegisteredShopLocation(lat, lng) {
  return isValidCoordinate(lat, lng) && isInServiceArea(lat, lng);
}

// ---------------------------------------------------------------------------
// Visit verification settings (stored in app_settings 'global')
// ---------------------------------------------------------------------------

export const VISIT_SETTING_RULES = Object.freeze({
  visitGeofenceRadiusM: { default: 100, min: 20, max: 1000, label: 'Geofence radius (metres)' },
  visitMaxGpsAccuracyM: { default: 30, min: 5, max: 200, label: 'Maximum GPS accuracy (metres)' },
  visitDuplicateWindowMinutes: { default: 30, min: 0, max: 240, label: 'Duplicate protection window (minutes)' },
  visitMaxFixAgeSeconds: { default: 60, min: 10, max: 600, label: 'Maximum GPS fix age (seconds)' },
  visitMaxTravelSpeedKmh: { default: 150, min: 30, max: 1000, label: 'Implausible travel speed (km/h)' }
});

/** Effective settings with defaults for anything missing or invalid. */
export function getVisitSettings(appSettings = {}) {
  const out = {};
  for (const [key, rule] of Object.entries(VISIT_SETTING_RULES)) {
    const v = Number(appSettings?.[key]);
    out[key] = Number.isFinite(v) && v >= rule.min && v <= rule.max ? v : rule.default;
  }
  return out;
}

/** Returns an error message for the first invalid visit setting in `updates`, or null. */
export function validateVisitSettingUpdates(updates = {}) {
  for (const [key, rule] of Object.entries(VISIT_SETTING_RULES)) {
    if (!(key in updates)) continue;
    const v = Number(updates[key]);
    if (!Number.isFinite(v) || v < rule.min || v > rule.max) {
      return `${rule.label} must be a number between ${rule.min} and ${rule.max}.`;
    }
  }
  return null;
}

/**
 * Decide the outcome of one verification attempt. Pure: all inputs come from the server
 * (shop coordinates from the database, settings, server-measured fix age), plus the device reading.
 *
 * Returns { status, distanceM, flags } where status is one of:
 *   location_not_registered | poor_accuracy | too_far | verified | flagged
 * Accuracy is checked independently of distance: a reading worse than the limit is never accepted.
 */
export function evaluateVisit({ shopLat, shopLng, lat, lng, accuracyM, settings, mockLocation = 'unknown', fixAgeMs = null, previousVisit = null, nowMs = Date.now() }) {
  if (!isRegisteredShopLocation(shopLat, shopLng)) {
    return { status: 'location_not_registered', distanceM: null, flags: [] };
  }
  const distanceM = Math.round(haversineMeters(Number(shopLat), Number(shopLng), Number(lat), Number(lng)) * 10) / 10;
  if (!(Number(accuracyM) > 0) || Number(accuracyM) > settings.visitMaxGpsAccuracyM) {
    return { status: 'poor_accuracy', distanceM, flags: [] };
  }
  if (distanceM > settings.visitGeofenceRadiusM) {
    return { status: 'too_far', distanceM, flags: [] };
  }

  const flags = [];
  if (mockLocation === 'yes') flags.push('mock_location_detected');
  if (fixAgeMs !== null && Number.isFinite(Number(fixAgeMs)) && Number(fixAgeMs) > settings.visitMaxFixAgeSeconds * 1000) {
    flags.push('stale_gps_fix');
  }
  if (previousVisit && isValidCoordinate(previousVisit.latitude, previousVisit.longitude)) {
    const meters = haversineMeters(Number(previousVisit.latitude), Number(previousVisit.longitude), Number(lat), Number(lng));
    const hours = Math.max((nowMs - Date.parse(previousVisit.visitedAt)) / 3600000, 1 / 3600);
    const kmh = meters / 1000 / hours;
    if (meters > 1000 && kmh > settings.visitMaxTravelSpeedKmh) flags.push('implausible_travel_speed');
  }
  return { status: flags.length ? 'flagged' : 'verified', distanceM, flags };
}
