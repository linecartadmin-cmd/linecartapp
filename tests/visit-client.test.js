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
    assert.match(java, /getCurrentLocation|requestSingleUpdate/);
    assert.match(java, /isMock\(\)/);
    assert.match(java, /isFromMockProvider\(\)/);
  });
  test('is registered before the bridge starts', () => {
    assert.ok(main.indexOf('registerPlugin(LocationIntegrityPlugin.class)') < main.indexOf('super.onCreate'));
  });
});
