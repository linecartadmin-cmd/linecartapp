/**
 * PR-7: large visit photos never travel in order lists, device caches cannot overflow, and sign-out
 * removes the previous user's private data.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenFor, api, initTestDb, IDS } from './helpers/session.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(120000);

let db;
let orderId;
const tokens = {};

before(async () => {
  db = await initTestDb();
  for (const [k, id] of Object.entries({ agent1: IDS.agent1, agent2: IDS.agent2, manager: IDS.manager, admin: IDS.admin, delivery: IDS.delivery })) {
    tokens[k] = await tokenFor(id);
  }
  const r = await api('/createorder', {
    token: tokens.agent1,
    method: 'POST',
    body: {
      idempotencyKey: `photo-${Date.now()}`,
      visitPhoto: PHOTO,
      orderList: [{ customerid: 101, itemid: 1, qty: 4, spersonid: IDS.agent1, clusterid: 1 }]
    }
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  orderId = r.json.orderId;
  const stored = await db.query('SELECT LENGTH(visit_photo) AS len FROM orders WHERE order_id = $1', [orderId]);
  assert.strictEqual(Number(stored.rows[0].len), PHOTO.length, 'photo is stored on the server');
});

describe('Order lists never include photo bodies', () => {
  for (const [label, who, route] of [
    ['agent /api/orders', 'agent1', '/api/orders'],
    ['admin /api/orders', 'admin', '/api/orders'],
    ['manager /api/manager/orders', 'manager', '/api/manager/orders'],
    ['admin /api/admin/orders', 'admin', '/api/admin/orders']
  ]) {
    test(label, async () => {
      const r = await api(route, { token: tokens[who] });
      assert.strictEqual(r.status, 200);
      const body = JSON.stringify(r.json);
      assert.ok(!body.includes('data:image/'), 'no base64 image in the list');
      const o = r.json.orders.find((x) => (x.orderId || x.id) === orderId);
      assert.ok(o, 'order is listed');
      assert.strictEqual(o.visitPhoto, null);
      assert.strictEqual(o.hasVisitPhoto, true);
    });
  }
});

describe('GET /api/orders/:id/visit-photo', () => {
  test('the placing agent, their manager and an admin can fetch it', async () => {
    for (const who of ['agent1', 'manager', 'admin']) {
      const r = await api(`/api/orders/${orderId}/visit-photo`, { token: tokens[who] });
      assert.strictEqual(r.status, 200, who);
      assert.strictEqual(r.json.visitPhoto, PHOTO);
    }
  });
  test('another agent cannot', async () => {
    const r = await api(`/api/orders/${orderId}/visit-photo`, { token: tokens.agent2 });
    assert.strictEqual(r.status, 403);
  });
  test('requires a session and returns 404 for unknown orders', async () => {
    assert.strictEqual((await api(`/api/orders/${orderId}/visit-photo`)).status, 401);
    assert.strictEqual((await api('/api/orders/NOPE-1/visit-photo', { token: tokens.admin })).status, 404);
  });
});

describe('Orders cache (client)', () => {
  function installQuotaStorage(maxBytes) {
    const data = new Map();
    globalThis.localStorage = {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => {
        const size = [...data.entries()].filter(([key]) => key !== k).reduce((s, [, val]) => s + val.length, 0) + String(v).length;
        if (size > maxBytes) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        data.set(k, String(v));
      },
      removeItem: (k) => data.delete(k)
    };
    return data;
  }

  test('strips photos, survives a full quota, and scopes the cache to its owner', async () => {
    const { saveOrdersCache, loadOrdersCache, clearOrdersCache } = await import('../client/src/offline/ordersCache.js');
    installQuotaStorage(60000);
    const orders = Array.from({ length: 800 }, (_, i) => ({ id: `S101-${i}`, total: i, visitPhoto: i < 5 ? PHOTO : null }));
    assert.doesNotThrow(() => saveOrdersCache(orders, 7));
    const loaded = loadOrdersCache(7);
    assert.ok(loaded.length > 0 && loaded.length <= 800);
    assert.ok(loaded.every((o) => o.visitPhoto === null), 'photos are never cached');
    assert.strictEqual(loaded[0].hasVisitPhoto, true);
    assert.deepStrictEqual(loadOrdersCache(8), [], 'another user never sees this cache');
    clearOrdersCache();
    assert.deepStrictEqual(loadOrdersCache(7), []);
  });

  test('a storage that always throws does not crash', async () => {
    const { saveOrdersCache, loadOrdersCache } = await import('../client/src/offline/ordersCache.js');
    globalThis.localStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); }
    };
    assert.strictEqual(saveOrdersCache([{ id: 'a' }], 1), false);
    assert.deepStrictEqual(loadOrdersCache(1), []);
  });
});

describe('Sign-out cleanup (client source)', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'client/src/App.jsx'), 'utf8');
  const logout = app.slice(app.indexOf('const handleLogout'), app.indexOf('const todayStr'));
  test('removes the biometric credential, cached data and order list of the leaving user', () => {
    assert.match(logout, /removeSavedAccount\(leavingUserId\)/);
    assert.match(logout, /clearUserCachedData\(leavingUserId\)/);
    assert.match(logout, /clearOrdersCache\(\)/);
    assert.match(logout, /ACTIVE_USER_KEY/);
  });
  test('warns before signing out with unsent updates and never deletes the sync queue', () => {
    assert.match(logout, /hasUnsyncedMutations\(leavingUserId\)/);
    const db = fs.readFileSync(path.join(repoRoot, 'client/src/offline/offlineDb.js'), 'utf8');
    const clearFn = db.slice(db.indexOf('export async function clearUserCachedData'), db.indexOf('// 1. User Profile'));
    assert.ok(!clearFn.includes("'sync_queue'"), 'sync_queue is not cleared on sign-out');
  });
  test('App.jsx no longer writes the order list to localStorage directly', () => {
    assert.ok(!app.includes("localStorage.setItem('linecart_orders'"));
  });
});
