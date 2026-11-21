/**
 * PR-3: order creation is online-only.
 * - No client code can queue an order on the device.
 * - The server exposes a cheap reachability probe.
 * - The server can refuse orders from app versions that could queue offline (MIN_ORDER_CLIENT_LEVEL).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tokenFor, IDS } from './helpers/session.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

describe('Client has no offline order path', () => {
  const clientFiles = walk(path.join(repoRoot, 'client/src')).filter((f) => /\.(js|jsx)$/.test(f));

  test('nothing calls or defines queueOrderCreation', () => {
    for (const f of clientFiles) {
      assert.ok(!fs.readFileSync(f, 'utf8').includes('queueOrderCreation'), `${path.relative(repoRoot, f)} still references queueOrderCreation`);
    }
  });

  test('no TEMP- order ids are created anywhere in the client', () => {
    for (const f of clientFiles) {
      const src = fs.readFileSync(f, 'utf8');
      assert.ok(!/`TEMP-\$\{/.test(src), `${path.relative(repoRoot, f)} creates TEMP- ids`);
    }
  });

  test('the sync engine never sends CREATE_ORDER entries to the server', () => {
    const src = read('client/src/offline/syncEngine.js');
    const branch = src.slice(src.indexOf("item.type === 'CREATE_ORDER'"), src.indexOf("item.type === 'UPDATE_DELIVERY_STATUS'"));
    assert.ok(branch.length > 0);
    assert.ok(!branch.includes('api.'), 'CREATE_ORDER branch must not call the API');
    assert.ok(branch.includes('legacyOfflineOrder: true'));
  });

  test('the offline store refuses to enqueue orders', () => {
    const src = read('client/src/offline/offlineDb.js');
    assert.match(src, /type === 'CREATE_ORDER'[\s\S]{0,200}throw new Error\('Orders cannot be queued offline/);
  });

  test('order screen blocks submission when offline and reuses one idempotency key per order', () => {
    const src = read('client/src/components/OrderEntryScreen.jsx');
    assert.match(src, /disabled=\{submitting \|\| isOffline/);
    assert.match(src, /submitKeyRef\.current\.fingerprint !== fingerprint/);
    assert.match(src, /api\.createOrder\(orderList, idempotencyKey/);
    assert.ok(!src.includes('saved locally'), 'no "saved locally" success messages');
  });

  test('removed order-creating dead components stay removed', () => {
    for (const name of ['APKOrderRequest', 'OrderBooking', 'BuyerDashboard', 'LineCartAPKView']) {
      assert.ok(!fs.existsSync(path.join(repoRoot, `client/src/components/${name}.jsx`)), `${name}.jsx exists`);
    }
  });
});

describe('Server', () => {
  test('GET /api/ping answers without authentication', async () => {
    const res = await fetch('http://localhost:3001/api/ping');
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).ok, true);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  });

  test('orders without a session are rejected with 401', async () => {
    const res = await fetch('http://localhost:3001/createorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderList: [{ customerid: 101, itemid: 1, qty: 1 }] })
    });
    assert.strictEqual(res.status, 401);
  });
});

describe('MIN_ORDER_CLIENT_LEVEL cut-off', () => {
  const PORT = 3102;
  let child;
  let token;

  before(async () => {
    token = await tokenFor(IDS.agent1);
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(PORT), MIN_ORDER_CLIENT_LEVEL: '2' },
      stdio: 'ignore'
    });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}/api/ping`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('second test server did not start');
  });

  after(() => {
    if (child) child.kill();
  });

  const post = (headers) =>
    fetch(`http://127.0.0.1:${PORT}/createorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({
        idempotencyKey: `lvl-${Date.now()}-${Math.random()}`,
        orderList: [{ customerid: 101, itemid: 1, qty: 3, spersonid: IDS.agent1, clusterid: 1 }]
      })
    });

  test('an old client (no level header) gets 426 Upgrade Required', async () => {
    const res = await post({});
    assert.strictEqual(res.status, 426);
    assert.match((await res.json()).message, /update the LineCart app/i);
  });

  test('the current client (level 2) can order', async () => {
    const res = await post({ 'X-LineCart-Client': '2' });
    assert.strictEqual(res.status, 200);
  });
});
