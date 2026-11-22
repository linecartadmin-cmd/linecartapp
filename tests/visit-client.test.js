/**
 * Client side of visit verification (scenarios 11 and 12 run on the device, so they are tested here
 * against the real client modules with a stubbed browser geolocation and fetch).
 */
import './helpers/vite-resolve.mjs';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const realFetch = globalThis.fetch;
let lastOptions = null;

function setGeolocation(impl) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true, geolocation: { getCurrentPosition: impl } }
  });
}

before(() => {
  globalThis.window = { isSecureContext: true, location: { protocol: 'http:', hostname: 'localhost', port: '3000' } };
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
});
after(() => {
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  globalThis.fetch = realFetch;
  delete globalThis.window;
});

describe('getFreshVisitLocation (browser path)', () => {
  test('11. permission denied gives a clear message and no location', async () => {
    const { getFreshVisitLocation } = await import('../client/src/utils/locationService.js');
    setGeolocation((ok, fail) => fail({ code: 1, message: 'User denied Geolocation' }));
    const r = await getFreshVisitLocation({ timeoutMs: 1000 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'permission_denied');
    assert.match(r.message, /Location permission is blocked/);
  });

  test('GPS timeout and unavailable are reported, never a fake position', async () => {
    const { getFreshVisitLocation } = await import('../client/src/utils/locationService.js');
    setGeolocation((ok, fail) => fail({ code: 3, message: 'Timeout expired' }));
    assert.strictEqual((await getFreshVisitLocation({ timeoutMs: 1000 })).reason, 'timeout');
    setGeolocation((ok, fail) => fail({ code: 2, message: 'Position unavailable' }));
    assert.strictEqual((await getFreshVisitLocation({ timeoutMs: 1000 })).ok, false);
  });

  test('asks for a fresh high-accuracy fix (maximumAge 0) and returns accuracy and fix time', async () => {
    const { getFreshVisitLocation } = await import('../client/src/utils/locationService.js');
    setGeolocation((ok, fail, options) => {
      lastOptions = options;
      ok({ coords: { latitude: 10.6583, longitude: 77.0082, accuracy: 8 }, timestamp: 1767225600000 });
    });
    const r = await getFreshVisitLocation({ timeoutMs: 1000 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.accuracy, 8);
    assert.strictEqual(r.fixTimestamp, 1767225600000);
    assert.strictEqual(r.mockLocation, 'unknown');
    assert.strictEqual(lastOptions.maximumAge, 0);
    assert.strictEqual(lastOptions.enableHighAccuracy, true);
  });
});

describe('api.verifyVisit network handling', () => {
  test('12. a dropped connection is reported as uncertain so the same key is resent', async () => {
    const { api } = await import('../client/src/api.js');
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(api.verifyVisit({ shopId: 1 }, 'key-1'), (e) => e.uncertain === true);
    globalThis.fetch = async () => ({ status: 502, json: async () => { throw new Error('html'); } });
    await assert.rejects(api.verifyVisit({ shopId: 1 }, 'key-1'), (e) => e.uncertain === true);
  });

  test('the idempotency key is sent in header and body', async () => {
    const { api } = await import('../client/src/api.js');
    let seen = null;
    globalThis.fetch = async (url, init) => {
      seen = init;
      return { status: 200, json: async () => ({ status: 200, result: 'verified' }) };
    };
    await api.verifyVisit({ shopId: 1 }, 'key-xyz');
    assert.strictEqual(seen.headers['X-Idempotency-Key'], 'key-xyz');
    assert.strictEqual(JSON.parse(seen.body).idempotencyKey, 'key-xyz');
  });
});

describe('getFreshVisitLocationWith (native Android path, stubbed plugin)', () => {
  const geo = (perm, requested = perm) => {
    const calls = { request: 0, getCurrentPosition: 0 };
    return {
      calls,
      checkPermissions: async () => perm,
      requestPermissions: async () => { calls.request += 1; return requested; },
      getCurrentPosition: async () => { calls.getCurrentPosition += 1; return { coords: { latitude: 10.1, longitude: 77.1, accuracy: 9 }, timestamp: 1 }; }
    };
  };
  const pluginOk = (over = {}) => ({ getFreshLocation: async (opts) => ({ latitude: 10.6583, longitude: 77.0082, accuracy: 12, time: 1767225600000, isMock: false, anyMock: false, meetsAccuracy: true, source: 'fused', waitedMs: 2100, opts, ...over }) });
  const pluginErr = (code, message = code) => ({ getFreshLocation: async () => { const e = new Error(message); e.code = code; throw e; } });
  const GRANTED = { location: 'granted', coarseLocation: 'granted' };
  const run = async (deps, opts) => {
    const { getFreshVisitLocationWith } = await import('../client/src/utils/locationService.js');
    return getFreshVisitLocationWith({ isNative: true, platform: 'android', webPosition: null, ...deps }, opts);
  };

  test('returns the fresh fused fix with coordinates, accuracy and the mock flag', async () => {
    let seen = null;
    const r = await run({ geolocation: geo(GRANTED), integrity: { getFreshLocation: async (o) => { seen = o; return (await pluginOk().getFreshLocation(o)); } } }, { timeoutMs: 20000, desiredAccuracyM: 30 });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual([r.latitude, r.longitude, r.accuracy], [10.6583, 77.0082, 12]);
    assert.strictEqual(r.mockLocation, 'no');
    assert.strictEqual(r.meetsAccuracy, true);
    assert.deepStrictEqual(seen, { timeoutMs: 20000, desiredAccuracyM: 30 }, 'the accuracy target is passed to the plugin');
  });

  test('approximate-only permission gives a "turn on precise location" message, not "permission off"', async () => {
    const g = geo({ location: 'prompt', coarseLocation: 'granted' }, { location: 'denied', coarseLocation: 'granted' });
    const r = await run({ geolocation: g, integrity: pluginOk() });
    assert.strictEqual(g.calls.request, 1, 'precise permission is requested');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'precise_required');
    assert.match(r.message, /Use precise location/);
  });

  test('no location permission at all is reported as permission_denied', async () => {
    const r = await run({ geolocation: geo({ location: 'denied', coarseLocation: 'denied' }), integrity: pluginOk() });
    assert.strictEqual(r.reason, 'permission_denied');
    assert.match(r.message, /Permissions → Location/);
  });

  test('plugin error codes map to clear reasons (GPS off, timeout, precise, unavailable)', async () => {
    for (const [code, reason] of [['SERVICES_DISABLED', 'services_disabled'], ['TIMEOUT', 'timeout'], ['PRECISE_REQUIRED', 'precise_required'], ['PERMISSION_DENIED', 'permission_denied'], ['UNAVAILABLE', 'unavailable']]) {
      const r = await run({ geolocation: geo(GRANTED), integrity: pluginErr(code) });
      assert.strictEqual(r.ok, false, code);
      assert.strictEqual(r.reason, reason, code);
      assert.ok(r.message.length > 20, `${code} has a useful message`);
    }
  });

  test('a plugin error never silently falls back to a different location source', async () => {
    const g = geo(GRANTED);
    await run({ geolocation: g, integrity: pluginErr('TIMEOUT') });
    assert.strictEqual(g.calls.getCurrentPosition, 0);
  });

  test('a fix that misses the accuracy limit is returned (meetsAccuracy=false) so the server applies the rule', async () => {
    const r = await run({ geolocation: geo(GRANTED), integrity: pluginOk({ accuracy: 48, meetsAccuracy: false }) }, { desiredAccuracyM: 30 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.accuracy, 48);
    assert.strictEqual(r.meetsAccuracy, false);
  });

  test('mock detection: any mock fix during the request marks the reading as mock', async () => {
    assert.strictEqual((await run({ geolocation: geo(GRANTED), integrity: pluginOk({ isMock: true }) })).mockLocation, 'yes');
    assert.strictEqual((await run({ geolocation: geo(GRANTED), integrity: pluginOk({ isMock: false, anyMock: true }) })).mockLocation, 'yes');
  });

  test('older app build without the plugin falls back to a fresh Capacitor fix with mock unknown', async () => {
    const g = geo(GRANTED);
    const r = await run({ geolocation: g, integrity: pluginErr('UNIMPLEMENTED', 'LocationIntegrity plugin is not implemented on android') });
    assert.strictEqual(g.calls.getCurrentPosition, 1);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.mockLocation, 'unknown');
    assert.strictEqual(r.source, 'capacitor-geolocation');
  });
});

describe('VisitsScreen behaviour (source checks)', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'client/src/components/VisitsScreen.jsx'), 'utf8');
  test('retries an uncertain result once with the SAME key, then shows a not-confirmed state', () => {
    assert.match(src, /const key = newKey\(\);[\s\S]*api\.verifyVisit\(payload, key\)[\s\S]*api\.verifyVisit\(payload, key\)[\s\S]*setPhase\('network_error'\)/);
  });
  test('blocks double submission and offline use, and never shows success without the server', () => {
    assert.match(src, /if \(!selected \|\| busyRef\.current\) return;/);
    assert.match(src, /disabled=\{busy \|\| !isConnected \|\| !selected\.locationRegistered\}/);
    assert.ok(!/setPhase\('verified'\)/.test(src), 'verified state only comes from the server result');
  });
  test('uses the fresh-location reader, not the cached shop-registration helper', () => {
    assert.match(src, /getFreshVisitLocation/);
    assert.ok(!src.includes('fetchCurrentDeviceLocation'));
  });
  test('passes the server accuracy limit to the GPS reader and shows the reading with a seconds counter', () => {
    assert.match(src, /getFreshVisitLocation\(\{ timeoutMs: 20000, desiredAccuracyM: maxAccuracyM \}\)/);
    assert.match(src, /data-testid="gps-reading"/);
    assert.match(src, /GETTING GPS… \$\{locSeconds\} s/);
  });
  test('shows every required state', () => {
    for (const s of ['locating', 'verifying', 'verified', 'flagged', 'too_far', 'poor_accuracy', 'location_not_registered', 'location_error', 'network_error', 'offline']) {
      assert.match(src, new RegExp(`\\b${s}:`), s);
    }
  });
});

describe('Android plugin', () => {
  const java = fs.readFileSync(path.join(repoRoot, 'client/android/app/src/main/java/in/linecart/suite/LocationIntegrityPlugin.java'), 'utf8');
  const main = fs.readFileSync(path.join(repoRoot, 'client/android/app/src/main/java/in/linecart/suite/MainActivity.java'), 'utf8');
  test('requests a new fix (no last-known location) and reports the mock flag', () => {
    assert.ok(!java.includes('getLastKnownLocation'));
    assert.ok(!java.includes('getLastLocation'));
    assert.match(java, /isMock\(\)/);
    assert.match(java, /isFromMockProvider\(\)/);
    assert.match(java, /anyMock/);
  });
  test('uses the fused provider (GPS + Wi-Fi + network, like customer Fetch Location), fresh fixes only', () => {
    assert.match(java, /FusedLocationProviderClient/);
    assert.match(java, /Priority\.PRIORITY_HIGH_ACCURACY/);
    assert.match(java, /setMaxUpdateAgeMillis\(0\)/);
    assert.match(java, /getElapsedRealtimeNanos\(\) < startElapsedNs/, 'fixes older than the request are ignored');
    assert.match(java, /GPS_PROVIDER[\s\S]*NETWORK_PROVIDER/, 'platform fallback listens to GPS and network');
  });
  test('requires precise permission and reports approximate-only separately', () => {
    assert.match(java, /ACCESS_FINE_LOCATION/);
    assert.match(java, /CODE_PRECISE_REQUIRED/);
    for (const code of ['PERMISSION_DENIED', 'PRECISE_REQUIRED', 'SERVICES_DISABLED', 'TIMEOUT']) assert.match(java, new RegExp(`"${code}"`));
  });
  test('the app declares the fused location library it uses', () => {
    const gradle = fs.readFileSync(path.join(repoRoot, 'client/android/app/build.gradle'), 'utf8');
    assert.match(gradle, /com\.google\.android\.gms:play-services-location/);
  });
  test('is registered before the bridge starts', () => {
    assert.ok(main.indexOf('registerPlugin(LocationIntegrityPlugin.class)') < main.indexOf('super.onCreate'));
  });
});
