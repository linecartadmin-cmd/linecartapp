/**
 * Scope fixes (Phase 0, T0.2). Synthetic orders on the disposable test database only.
 * Fixture shops 33, 34, 36, 40 are in cluster 1 and assigned to Agent 2; Delivery Agent 50.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, initTestDb, tokenFor, IDS } from './helpers/session.mjs';

const db = await initTestDb();
const ORDER_ID = 'T02-DA-0001';

async function insertDeliveryOrder({ orderId = ORDER_ID, shopId, status = 'In progress', deliveryAgentId = IDS.delivery }) {
  const serial = 900000 + Math.floor(Math.random() * 90000);
  await db.query(
    `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name,
                         cluster_id, order_date, expected_delivery_date, created_at, status, items_count, total,
                         delivery_agent_id, payment_status, payment_amount_collected, payment_balance_due)
     VALUES ($1, $2, $3, $4, $5, 'Retail', $6, 'Test Agent', 1, '2026-11-20', '2026-11-21', '2026-11-20T05:00:00.000Z',
             $7, 0, 0, $8, 'Not collected', 0, 0)`,
    [orderId, serial, `S${String(shopId).padStart(3, '0')}`, shopId, `Test Shop ${shopId}`, IDS.agent2, status, deliveryAgentId]
  );
}

async function removeOrder(orderId = ORDER_ID) {
  await db.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
  await db.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
}

const shopIdsOf = (json) => new Set((json?.shops || []).map((s) => Number(s.shopid)));

test('R1: a Delivery Agent lists only shops on their own open deliveries', async () => {
  const da = await tokenFor(IDS.delivery);
  await removeOrder();
  const before = await api('/api/shops', { token: da });
  assert.equal(before.status, 200);
  for (const id of [33, 34, 36, 40]) assert.ok(!shopIdsOf(before.json).has(id), `shop ${id} not listed before any delivery`);

  await insertDeliveryOrder({ shopId: 33 });
  try {
    const during = await api('/api/shops', { token: da });
    assert.equal(during.status, 200);
    const ids = shopIdsOf(during.json);
    assert.ok(ids.has(33), 'shop on an open delivery is listed');
    for (const id of [34, 36, 40]) assert.ok(!ids.has(id), `shop ${id} without a delivery is not listed`);
    // Response shape unchanged
    const shop = during.json.shops.find((s) => Number(s.shopid) === 33);
    assert.equal(shop.assignedAgentId, IDS.agent2);
    assert.equal(typeof shop.assignedAgentName, 'string');

    // Another delivery agent does not see it
    const otherDa = await db.query("SELECT id FROM users WHERE role = 'Delivery Agent' AND id <> $1 AND active = 1 LIMIT 1", [IDS.delivery]);
    if (otherDa.rowCount) {
      const other = await api('/api/shops', { token: await tokenFor(otherDa.rows[0].id) });
      assert.ok(!shopIdsOf(other.json).has(33));
    }

    await db.query("UPDATE orders SET status = 'Delivered' WHERE order_id = $1", [ORDER_ID]);
    const after = await api('/api/shops', { token: da });
    assert.ok(!shopIdsOf(after.json).has(33), 'a delivered order no longer opens the shop');
  } finally {
    await removeOrder();
  }
});

test('admin, manager and field agent shop lists are unchanged', async () => {
  const all = (await db.query('SELECT COUNT(*) AS n FROM shops')).rows[0].n;
  const admin = await api('/api/shops', { token: await tokenFor(IDS.admin) });
  assert.equal(admin.status, 200);
  assert.equal(admin.json.shops.length, Number(all));

  const agent2 = await api('/api/shops', { token: await tokenFor(IDS.agent2) });
  assert.equal(agent2.status, 200);
  for (const id of [33, 34, 36, 40]) assert.ok(shopIdsOf(agent2.json).has(id));
  assert.ok(agent2.json.shops.every((s) => Number(s.assignedAgentId) === IDS.agent2));

  const agent1 = await api('/api/shops', { token: await tokenFor(IDS.agent1) });
  for (const id of [33, 34, 36, 40]) assert.ok(!shopIdsOf(agent1.json).has(id), 'agent 1 does not see agent 2 shops');

  const manager = await api('/api/shops', { token: await tokenFor(IDS.manager) });
  assert.equal(manager.status, 200);
  assert.ok(manager.json.shops.length > 0);
});

test('shop access for a Delivery Agent follows their deliveries, not their cluster', async () => {
  const da = await tokenFor(IDS.delivery);
  await removeOrder();
  // Shop 34 is in the agent's cluster but has no delivery for them
  const denied = await api('/api/shops/34/order-history', { token: da });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'FORBIDDEN');
  await insertDeliveryOrder({ shopId: 34 });
  try {
    const allowed = await api('/api/shops/34/order-history', { token: da });
    assert.equal(allowed.status, 200);
  } finally {
    await removeOrder();
  }
});

test('field agent and manager order history access is unchanged', async () => {
  assert.equal((await api('/api/shops/34/order-history', { token: await tokenFor(IDS.agent2) })).status, 200);
  assert.equal((await api('/api/shops/34/order-history', { token: await tokenFor(IDS.agent1) })).status, 403);
  assert.equal((await api('/api/shops/34/order-history', { token: await tokenFor(IDS.admin) })).status, 200);
});

test('GET /api/orders keeps each staff role in its own scope', async () => {
  await insertDeliveryOrder({ shopId: 33 });
  try {
    const da = await api('/api/orders', { token: await tokenFor(IDS.delivery) });
    assert.equal(da.status, 200);
    assert.ok(da.json.orders.every((o) => Number(o.deliveryAgentId) === IDS.delivery));
    assert.ok(da.json.orders.some((o) => o.orderId === ORDER_ID));

    const a2 = await api('/api/orders', { token: await tokenFor(IDS.agent2) });
    assert.ok(a2.json.orders.every((o) => Number(o.spersonid) === IDS.agent2));
    assert.ok(a2.json.orders.some((o) => o.orderId === ORDER_ID));

    const a1 = await api('/api/orders', { token: await tokenFor(IDS.agent1) });
    assert.ok(a1.json.orders.every((o) => Number(o.spersonid) === IDS.agent1));

    const admin = await api('/api/orders', { token: await tokenFor(IDS.admin) });
    assert.ok(admin.json.orders.some((o) => o.orderId === ORDER_ID));
  } finally {
    await removeOrder();
  }
});

test('reports, cluster info and the order catalog still answer for staff roles', async () => {
  for (const who of [IDS.admin, IDS.manager, IDS.agent2]) {
    const token = await tokenFor(who);
    for (const p of ['/gethomereport', '/clusterinfo', '/getitemsorder']) {
      const r = await api(p, { token });
      assert.equal(r.status, 200, `${p} as ${who}`);
    }
  }
  const agent2 = await api('/getitemsorder', { token: await tokenFor(IDS.agent2) });
  const listed = agent2.json.result.clusterList.flatMap((c) => (c.shopsList || []).map((s) => Number(s.shopid)));
  for (const id of [33, 34, 36, 40]) assert.ok(listed.includes(id), `agent 2 catalog lists shop ${id}`);
  assert.ok(agent2.json.result.clusterList.every((c) => c.shopsList.every((s) => Number(s.assignedAgentId || s.assigned_agent_id) === IDS.agent2)));
  // Delivery agents never had these and still do not
  const da = await tokenFor(IDS.delivery);
  for (const p of ['/gethomereport', '/clusterinfo', '/getitemsorder']) {
    assert.equal((await api(p, { token: da })).status, 403);
  }
});
