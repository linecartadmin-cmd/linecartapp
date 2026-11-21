/**
 * Server-side distance and visit decision logic (server/geo.js), tested independently of the API.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  haversineMeters,
  isValidCoordinate,
  isRegisteredShopLocation,
  getVisitSettings,
  validateVisitSettingUpdates,
  evaluateVisit
} from '../server/geo.js';

const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected} ± ${tolerance}, got ${actual}`);

describe('haversineMeters', () => {
  test('zero for the same point', () => {
    assert.strictEqual(haversineMeters(10.6583, 77.0082, 10.6583, 77.0082), 0);
  });
  test('one thousandth of a degree of latitude is about 111 m', () => {
    near(haversineMeters(10.6583, 77.0082, 10.6593, 77.0082), 111.2, 0.5);
  });
  test('longitude distance shrinks with latitude (cos 10.66 deg)', () => {
    near(haversineMeters(10.6583, 77.0082, 10.6583, 77.0092), 109.3, 0.5);
  });
  test('known city pair: Chennai to Coimbatore is about 425 km', () => {
    near(haversineMeters(13.0827, 80.2707, 11.0168, 76.9558) / 1000, 425, 10);
  });
  test('symmetric', () => {
    const a = haversineMeters(10.1, 77.2, 10.2, 77.3);
    const b = haversineMeters(10.2, 77.3, 10.1, 77.2);
    near(a, b, 1e-6);
  });
});

describe('coordinate validation', () => {
  test('rejects missing, non-numeric, out-of-range and 0,0', () => {
    for (const [la, lo] of [[null, 77], ['', ''], ['abc', 77], [NaN, 77], [91, 77], [10, 181], [0, 0], [Infinity, 1]]) {
      assert.strictEqual(isValidCoordinate(la, lo), false, `${la},${lo}`);
    }
    assert.strictEqual(isValidCoordinate('10.5', '77.1'), true);
  });
  test('registered shop locations must be inside India', () => {
    assert.strictEqual(isRegisteredShopLocation(10.6583, 77.0082), true);
    assert.strictEqual(isRegisteredShopLocation(51.5, -0.12), false);
    assert.strictEqual(isRegisteredShopLocation(0, 0), false);
  });
});

describe('visit settings', () => {
  test('defaults are 100 m radius, 30 m accuracy, 30 min duplicate window', () => {
    const s = getVisitSettings({});
    assert.strictEqual(s.visitGeofenceRadiusM, 100);
    assert.strictEqual(s.visitMaxGpsAccuracyM, 30);
    assert.strictEqual(s.visitDuplicateWindowMinutes, 30);
  });
  test('out-of-range stored values fall back to defaults; updates are validated', () => {
    assert.strictEqual(getVisitSettings({ visitGeofenceRadiusM: 5 }).visitGeofenceRadiusM, 100);
    assert.match(validateVisitSettingUpdates({ visitGeofenceRadiusM: 5000 }), /between 20 and 1000/);
    assert.strictEqual(validateVisitSettingUpdates({ visitGeofenceRadiusM: 150, organizationName: 'x' }), null);
  });
});

describe('evaluateVisit', () => {
  const settings = getVisitSettings({});
  const base = { shopLat: 10.6583, shopLng: 77.0082, settings };

  test('inside the geofence with good accuracy is verified', () => {
    const r = evaluateVisit({ ...base, lat: 10.65875, lng: 77.0082, accuracyM: 12 });
    assert.strictEqual(r.status, 'verified');
    near(r.distanceM, 50, 1);
  });
  test('outside the geofence is too_far, with the distance', () => {
    const r = evaluateVisit({ ...base, lat: 10.6603, lng: 77.0082, accuracyM: 10 });
    assert.strictEqual(r.status, 'too_far');
    near(r.distanceM, 222, 2);
  });
  test('accuracy is checked independently: poor accuracy is refused even right at the shop', () => {
    const r = evaluateVisit({ ...base, lat: 10.6583, lng: 77.0082, accuracyM: 45 });
    assert.strictEqual(r.status, 'poor_accuracy');
  });
  test('missing shop coordinates never verify', () => {
    const r = evaluateVisit({ ...base, shopLat: 0, shopLng: 0, lat: 10.6583, lng: 77.0082, accuracyM: 5 });
    assert.strictEqual(r.status, 'location_not_registered');
  });
  test('mock location, stale fix and implausible travel are flagged, not verified', () => {
    assert.deepStrictEqual(evaluateVisit({ ...base, lat: 10.6583, lng: 77.0082, accuracyM: 5, mockLocation: 'yes' }).flags, ['mock_location_detected']);
    assert.strictEqual(evaluateVisit({ ...base, lat: 10.6583, lng: 77.0082, accuracyM: 5, fixAgeMs: 120000 }).status, 'flagged');
    const now = Date.parse('2026-11-21T10:00:00Z');
    const r = evaluateVisit({
      ...base, lat: 10.6583, lng: 77.0082, accuracyM: 5, nowMs: now,
      previousVisit: { latitude: 8.7642, longitude: 78.1348, visitedAt: '2026-11-21T09:50:00Z' }
    });
    assert.ok(r.flags.includes('implausible_travel_speed'));
  });
  test('a plausible previous visit does not flag', () => {
    const now = Date.parse('2026-11-21T10:00:00Z');
    const r = evaluateVisit({
      ...base, lat: 10.6583, lng: 77.0082, accuracyM: 5, nowMs: now,
      previousVisit: { latitude: 10.5751, longitude: 77.253, visitedAt: '2026-11-21T09:00:00Z' }
    });
    assert.strictEqual(r.status, 'verified');
  });
});
