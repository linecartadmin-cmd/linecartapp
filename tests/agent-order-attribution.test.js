import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenFor, api, initTestDb, IDS } from './helpers/session.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readClient = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const EIGHT_AGENTS = [
  { id: 905, name: 'Sampath Kumar', phone: '9876500905' },
  { id: 906, name: 'Vignesh', phone: '9876500906' },
  { id: 907, name: 'Senthil', phone: '9876500907' },
  { id: 908, name: 'Shanmugam', phone: '9876500908' },
  { id: 909, name: 'Guru Prasanth', phone: '9876500909' },
  { id: 910, name: 'Arjun', phone: '9876500910' },
  { id: 911, name: 'Selvavignesh P', phone: '9876500911' },
  { id: 912, name: 'Jagadeesh', phone: '9876500912' }
];

const TEST_SHOP_BASE = 9900;
let db;
const tokens = {};
const createdOrderIds = [];
const createdShopIds = [];
const createdUserIds = [];

describe('Agent Order Attribution & Identity Integrity', () => {
  before(async () => {
    db = await initTestDb();
    const nowSql = new Date().toISOString().slice(0, 19).replace('T', ' ');

    for (let idx = 0; idx < EIGHT_AGENTS.length; idx++) {
      const ag = EIGHT_AGENTS[idx];
      const existing = await db.query('SELECT id FROM users WHERE id = $1', [ag.id]);
      if (existing.rowCount === 0) {
        await db.query(
          `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
           VALUES ($1, $2, 'Field Sales Agent', $3, 1, 'test-hash', 0, 1, 1, $4)`,
          [ag.id, ag.name, ag.phone, nowSql]
        );
        createdUserIds.push(ag.id);
      }
      tokens[ag.id] = await tokenFor(ag.id);

      const shopId = TEST_SHOP_BASE + ag.id;
      const existingShop = await db.query('SELECT shop_id FROM shops WHERE shop_id = $1', [shopId]);
      if (existingShop.rowCount === 0) {
        await db.query(
          `INSERT INTO shops (shop_id, cluster_id, shop_name, shop_category, owner_name, contact1, address, pincode, payment_mode, created_by, assigned_agent_id, active, created_on)
           VALUES ($1, 1, $2, 'HoReCa', 'Test Owner', $3, 'Test Street', '642001', 0, 1, $4, 1, $5)`,
          [shopId, `Test Shop ${ag.name}`, `980000${ag.id}`, ag.id, nowSql]
        );
        createdShopIds.push(shopId);
      }
    }

    // Unassigned shop created_by 912 (must NEVER fall back to created_by for access)
    const creatorOnlyShopId = TEST_SHOP_BASE + 999;
    await db.query(
      `INSERT INTO shops (shop_id, cluster_id, shop_name, shop_category, owner_name, contact1, address, pincode, payment_mode, created_by, assigned_agent_id, active, created_on)
       VALUES ($1, 1, 'Creator Only Shop 912', 'Retail', 'Creator Owner', '9800099999', 'Creator Rd', '642001', 0, 912, NULL, 1, $2)`,
      [creatorOnlyShopId, nowSql]
    );
    createdShopIds.push(creatorOnlyShopId);

    tokens.admin = await tokenFor(IDS.admin);
    tokens.manager = await tokenFor(IDS.manager);
  });

  after(async () => {
    for (const orderId of createdOrderIds) {
      await db.query('DELETE FROM price_requests WHERE order_id = $1', [orderId]);
      await db.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
      await db.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
    }
    for (const shopId of createdShopIds) {
      await db.query('DELETE FROM shops WHERE shop_id = $1', [shopId]);
    }
    await db.query('DELETE FROM manager_assignments WHERE manager_id = $1 AND agent_id = 912', [IDS.manager]);
    for (const uid of createdUserIds) {
      await db.query('DELETE FROM sessions WHERE user_id = $1', [uid]);
      await db.query('DELETE FROM users WHERE id = $1', [uid]);
    }
  });

  test('Agent 912 (Jagadeesh) places order without client spersonid and attributes to 912 with accurate totals/GPS', async () => {
    const shopId = TEST_SHOP_BASE + 912;
    const itemRes = await db.query('SELECT item_id, price FROM items WHERE item_id = 1');
    const catalogPrice = Number(itemRes.rows[0].price);
    const qty = 50;
    const expectedTotal = Number((qty * catalogPrice).toFixed(2));

    const r = await api('/createorder', {
      token: tokens[912],
      method: 'POST',
      body: {
        idempotencyKey: `attr-912-omit-${Date.now()}`,
        locationLat: 10.6583,
        locationLng: 77.0082,
        locationAccuracy: 8,
        orderList: [
          {
            customerid: shopId,
            itemid: 1,
            qty,
            clusterid: 1
          }
        ]
      }
    });

    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.orderId);
    createdOrderIds.push(r.json.orderId);

    const dbOrder = await db.query(
      'SELECT sperson_id, agent_name, customer_id, items_count, total, location_lat, location_lng, location_accuracy FROM orders WHERE order_id = $1',
      [r.json.orderId]
    );
    assert.strictEqual(dbOrder.rowCount, 1);
    const row = dbOrder.rows[0];
    assert.strictEqual(Number(row.sperson_id), 912);
    assert.strictEqual(row.agent_name, 'Jagadeesh');
    assert.strictEqual(Number(row.customer_id), shopId);
    assert.strictEqual(Number(row.items_count), 1);
    assert.strictEqual(Number(row.total), expectedTotal);
    assert.strictEqual(Number(row.location_lat), 10.6583);
    assert.strictEqual(Number(row.location_lng), 77.0082);
    assert.strictEqual(Number(row.location_accuracy), 8);
  });

  test('Agent 912 sending stale client spersonid=1 or spoofed spersonid=906 still attributes strictly to 912', async () => {
    const shopId = TEST_SHOP_BASE + 912;
    for (const badClientId of [1, 906]) {
      const r = await api('/createorder', {
        token: tokens[912],
        method: 'POST',
        body: {
          idempotencyKey: `attr-912-spoof-${badClientId}-${Date.now()}`,
          orderList: [
            {
              customerid: shopId,
              itemid: 1,
              qty: 4,
              spersonid: badClientId,
              clusterid: 1
            }
          ]
        }
      });

      assert.strictEqual(r.status, 200, `Expected 200 with server-derived attribution for payload spersonid=${badClientId}: ${JSON.stringify(r.json)}`);
      createdOrderIds.push(r.json.orderId);

      const dbOrder = await db.query('SELECT sperson_id, agent_name FROM orders WHERE order_id = $1', [r.json.orderId]);
      assert.strictEqual(Number(dbOrder.rows[0].sperson_id), 912);
      assert.strictEqual(dbOrder.rows[0].agent_name, 'Jagadeesh');

      const dbItem = await db.query('SELECT item_json FROM order_items WHERE order_id = $1', [r.json.orderId]);
      const parsedItem = JSON.parse(dbItem.rows[0].item_json);
      assert.strictEqual(Number(parsedItem.spersonid), 912);
    }
  });

  test('Agent 911 (Selvavignesh P) and all six existing agents (905-910) submit orders attributed to their own IDs', async () => {
    for (const ag of EIGHT_AGENTS.filter((a) => a.id !== 912)) {
      const shopId = TEST_SHOP_BASE + ag.id;
      const r = await api('/createorder', {
        token: tokens[ag.id],
        method: 'POST',
        body: {
          idempotencyKey: `attr-agent-${ag.id}-${Date.now()}`,
          orderList: [
            {
              customerid: shopId,
              itemid: 1,
              qty: 2,
              // Even if an older client passes stale spersonid=1, backend uses caller.id
              spersonid: 1,
              clusterid: 1
            }
          ]
        }
      });
      assert.strictEqual(r.status, 200, `Agent ${ag.id} (${ag.name}): ${JSON.stringify(r.json)}`);
      createdOrderIds.push(r.json.orderId);

      const dbOrder = await db.query('SELECT sperson_id, agent_name, customer_id FROM orders WHERE order_id = $1', [r.json.orderId]);
      assert.strictEqual(Number(dbOrder.rows[0].sperson_id), ag.id);
      assert.strictEqual(dbOrder.rows[0].agent_name, ag.name);
      assert.strictEqual(Number(dbOrder.rows[0].customer_id), shopId);
    }
  });

  test('Agent 912 cannot order on another agent shop or unassigned created_by shop (HTTP 403)', async () => {
    // Another agent's shop (906) even if payload claims spersonid=906
    const otherShop = await api('/createorder', {
      token: tokens[912],
      method: 'POST',
      body: {
        idempotencyKey: `attr-912-other-${Date.now()}`,
        orderList: [
          {
            customerid: TEST_SHOP_BASE + 906,
            itemid: 1,
            qty: 1,
            spersonid: 906,
            clusterid: 1
          }
        ]
      }
    });
    assert.strictEqual(otherShop.status, 403);

    // Unassigned shop where created_by=912 must still be denied
    const createdByOnly = await api('/createorder', {
      token: tokens[912],
      method: 'POST',
      body: {
        idempotencyKey: `attr-912-createdby-${Date.now()}`,
        orderList: [
          {
            customerid: TEST_SHOP_BASE + 999,
            itemid: 1,
            qty: 1,
            clusterid: 1
          }
        ]
      }
    });
    assert.strictEqual(createdByOnly.status, 403);
  });

  test('Admin and authorized Sales Manager attribution workflows remain preserved', async () => {
    // Admin placing order attributed to 912
    const adm = await api('/createorder', {
      token: tokens.admin,
      method: 'POST',
      body: {
        idempotencyKey: `attr-adm-912-${Date.now()}`,
        orderList: [{ customerid: TEST_SHOP_BASE + 912, itemid: 1, qty: 3, spersonid: 912, clusterid: 1 }]
      }
    });
    assert.strictEqual(adm.status, 200, JSON.stringify(adm.json));
    createdOrderIds.push(adm.json.orderId);
    const admRow = await db.query('SELECT sperson_id FROM orders WHERE order_id = $1', [adm.json.orderId]);
    assert.strictEqual(Number(admRow.rows[0].sperson_id), 912);

    // Enable create_order temporarily for Sales Manager and assign 912 (not 911)
    const permRow = await db.query("SELECT actions_json FROM role_permissions WHERE role = 'Sales Manager'");
    const originalActionsJson = permRow.rows[0]?.actions_json;
    const actions = JSON.parse(originalActionsJson);
    if (!actions.includes('create_order')) actions.push('create_order');
    await db.query("UPDATE role_permissions SET actions_json = $1 WHERE role = 'Sales Manager'", [JSON.stringify(actions)]);
    await db.query('INSERT INTO manager_assignments (manager_id, agent_id) VALUES ($1, $2)', [IDS.manager, 912]);

    try {
      const mgrOk = await api('/createorder', {
        token: tokens.manager,
        method: 'POST',
        body: {
          idempotencyKey: `attr-mgr-ok-${Date.now()}`,
          orderList: [{ customerid: TEST_SHOP_BASE + 912, itemid: 1, qty: 3, spersonid: 912, clusterid: 1 }]
        }
      });
      assert.strictEqual(mgrOk.status, 200, JSON.stringify(mgrOk.json));
      createdOrderIds.push(mgrOk.json.orderId);
      const mgrRow = await db.query('SELECT sperson_id FROM orders WHERE order_id = $1', [mgrOk.json.orderId]);
      assert.strictEqual(Number(mgrRow.rows[0].sperson_id), 912);

      // Manager cannot attribute to unassigned agent 911
      const mgrDenied = await api('/createorder', {
        token: tokens.manager,
        method: 'POST',
        body: {
          idempotencyKey: `attr-mgr-deny-${Date.now()}`,
          orderList: [{ customerid: TEST_SHOP_BASE + 911, itemid: 1, qty: 3, spersonid: 911, clusterid: 1 }]
        }
      });
      assert.strictEqual(mgrDenied.status, 403);
    } finally {
      await db.query('DELETE FROM manager_assignments WHERE manager_id = $1 AND agent_id = 912', [IDS.manager]);
      await db.query("UPDATE role_permissions SET actions_json = $1 WHERE role = 'Sales Manager'", [originalActionsJson]);
    }
  });

  test('Client code removes hardcoded spersonid=1 fallback and keeps user.id across offline/biometric restore', () => {
    const orderEntrySrc = readClient('client/src/components/OrderEntryScreen.jsx');
    assert.ok(!orderEntrySrc.includes("localStorage.getItem('LineCartPref_userid') || 1"), 'OrderEntryScreen must not fall back to literal user ID 1');
    assert.ok(orderEntrySrc.includes('authenticatedUserId'), 'OrderEntryScreen must validate authenticatedUserId before submit');

    const customersSrc = readClient('client/src/components/CustomersScreen.jsx');
    assert.ok(!customersSrc.includes("localStorage.getItem('LineCartPref_userid') || 1"), 'CustomersScreen must not fall back to literal user ID 1');

    const reportsSrc = readClient('client/src/components/ReportsScreen.jsx');
    assert.ok(!reportsSrc.includes("localStorage.getItem('LineCartPref_userid') || 6"), 'ReportsScreen must not fall back to literal user ID 6');

    const offlineDbSrc = readClient('client/src/offline/offlineDb.js');
    assert.match(offlineDbSrc, /id:\s*uid,\s*\r?\n\s*userId:\s*uid/);

    const bioSrc = readClient('client/src/offline/biometricAuth.js');
    assert.match(bioSrc, /const resolvedId = Number\(profile\?\.id \?\? profile\?\.userId \?\? userId\)/);
  });
});
