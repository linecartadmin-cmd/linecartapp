/**
 * PR-2: identifier allocation and idempotency must hold under concurrent requests.
 * Runs against the embedded engine used by the test runner. The PostgreSQL advisory-lock path is
 * exercised by the same code; see docs/IMPLEMENTATION_STATUS.md for the Postgres verification status.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { tokenFor, api, initTestDb, IDS } from './helpers/session.mjs';

let db;
let agentToken;
let adminToken;

function orderBody(qty, key) {
  return {
    idempotencyKey: key,
    orderList: [{ customerid: 101, itemid: 1, qty, spersonid: IDS.agent1, clusterid: 1 }]
  };
}

before(async () => {
  db = await initTestDb();
  agentToken = await tokenFor(IDS.agent1);
  adminToken = await tokenFor(IDS.admin);
});

describe('Concurrent identifier allocation', () => {
  test('20 simultaneous orders all succeed with unique serials and order ids', async () => {
    const stamp = Date.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        api('/createorder', { token: agentToken, method: 'POST', body: orderBody(100 + i, `conc-${stamp}-${i}`) })
      )
    );
    for (const r of results) assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const serials = results.map((r) => r.json.id);
    const orderIds = results.map((r) => r.json.orderId);
    assert.strictEqual(new Set(serials).size, 20, 'serials are unique');
    assert.strictEqual(new Set(orderIds).size, 20, 'order ids are unique');
    for (const oid of orderIds) assert.match(oid, /^S101-\d+$/, 'order number format preserved');

    const lines = await db.query(
      `SELECT order_id, COUNT(*) AS cnt FROM order_items WHERE order_id IN (${orderIds.map((_, i) => `$${i + 1}`).join(',')}) GROUP BY order_id`,
      orderIds
    );
    assert.strictEqual(lines.rows.length, 20, 'every order has its line');
    const dupIds = await db.query('SELECT id FROM order_items GROUP BY id HAVING COUNT(*) > 1');
    assert.strictEqual(dupIds.rows.length, 0, 'no duplicate order_items ids');
  });

  test('8 simultaneous retries with the same idempotency key create exactly one order', async () => {
    const key = `same-key-${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => api('/createorder', { token: agentToken, method: 'POST', body: orderBody(77, key) }))
    );
    for (const r of results) assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(new Set(results.map((r) => r.json.orderId)).size, 1, 'all responses name the same order');
    assert.strictEqual(results.filter((r) => !r.json.idempotentReplay).length, 1, 'only one request created it');
    const rows = await db.query('SELECT COUNT(*) AS cnt FROM orders WHERE idempotency_key = $1', [key]);
    assert.strictEqual(Number(rows.rows[0].cnt), 1);
  });

  test('5 simultaneous admin user creations get unique ids', async () => {
    const base = 9000000000 + (Date.now() % 100000000);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        api('/api/admin/users', {
          token: adminToken,
          method: 'POST',
          body: { name: `Concurrent User ${i}`, phone: String(base + i), role: 'Field Sales Agent', clusterid: 1 }
        })
      )
    );
    for (const r of results) assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    assert.strictEqual(new Set(results.map((r) => r.json.user.id)).size, 5);
  });

  test('every allocation site takes its lock before MAX()+1', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, idx) => {
      if (!/SELECT COALESCE\(MAX\(/.test(line) && !/COALESCE\(\(SELECT MAX\(/.test(line)) return;
      let start = idx;
      while (start > 0 && !/withTransaction\(async \(tx\)/.test(lines[start])) start -= 1;
      assert.ok(start > 0, `MAX()+1 at server/index.js:${idx + 1} is not inside a transaction`);
      const window = lines.slice(start, idx).join('\n');
      assert.match(window, /lockAllocation\(tx, '/, `MAX()+1 at server/index.js:${idx + 1} has no lockAllocation in its transaction`);
    });
  });
});
