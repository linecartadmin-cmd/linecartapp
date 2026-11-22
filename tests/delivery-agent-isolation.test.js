/**
 * Delivery Agent isolation (Stage A review, L8a) and historical shop access (L7).
 *
 * Two Delivery Agents: fixture DA 50 and a synthetic second DA. Each has one delivery at a
 * different fixture shop (33 and 34, both cluster 1, assigned to Agent 2). Neither may reach the
 * other's shop through the shop list, order history or shop photo, nor the other's delivery.
 *
 * L7 (owner decision, 23 Nov 2026): a Delivery Agent keeps historical access to every shop they
 * have been assigned at least one delivery to, also after every delivery there is Delivered,
 * Cancelled or Rejected. Shops never assigned to them stay out of reach, and isolation between
 * agents holds after closure too.
 *
 * Synthetic records only; the two test photos are written to the gitignored local uploads folder
 * and removed afterwards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, BASE_URL, initTestDb, insertTestUser, tokenFor, IDS } from './helpers/session.mjs';

const db = await initTestDb();
const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'uploads', 'shops');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

async function insertDelivery(orderId, shopId, deliveryAgentId, serial) {
  await db.query(
    `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name,
                         cluster_id, order_date, expected_delivery_date, created_at, status, items_count, total,
                         delivery_agent_id, payment_status, payment_amount_collected, payment_balance_due)
     VALUES ($1, $2, $3, $4, $5, 'Retail', $6, 'Test Agent', 1, '2026-11-20', '2026-11-21', '2026-11-20T05:00:00.000Z',
             'In progress', 0, 0, $7, 'Not collected', 0, 0)`,
    [orderId, serial, `S${String(shopId).padStart(3, '0')}`, shopId, `Test Shop ${shopId}`, IDS.agent2, deliveryAgentId]
  );
}

async function setup(t) {
  const second = await insertTestUser(db, { name: 'L8 Second Delivery Agent', role: 'Delivery Agent', clusterId: 1, phone: '9876508101' });
  const base = 980000 + Math.floor(Math.random() * 9000);
  const A = { id: IDS.delivery, shop: 33, otherShop: 34, order: `L8A-${base}-A`, photo: `shop_33_${crypto.randomUUID()}.jpg` };
  const B = { id: second.id, shop: 34, otherShop: 33, order: `L8A-${base}-B`, photo: `shop_34_${crypto.randomUUID()}.jpg` };
  A.otherPhoto = B.photo; B.otherPhoto = A.photo;
  A.otherOrder = B.order; B.otherOrder = A.order;
  await insertDelivery(A.order, A.shop, A.id, base);
  await insertDelivery(B.order, B.shop, B.id, base + 1);
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, A.photo), JPEG);
  fs.writeFileSync(path.join(uploadsDir, B.photo), JPEG);
  A.token = await tokenFor(A.id);
  B.token = await tokenFor(B.id);
  t.after(async () => {
    for (const f of [A.photo, B.photo]) { try { fs.unlinkSync(path.join(uploadsDir, f)); } catch {} }
    await db.query('DELETE FROM orders WHERE order_id IN ($1, $2)', [A.order, B.order]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [second.id]);
    await db.query('DELETE FROM users WHERE id = $1', [second.id]);
  });
  return { A, B };
}

const shopIds = (json) => new Set((json?.shops || []).map((s) => Number(s.shopid)));
const photoStatus = async (token, name) =>
  (await fetch(`${BASE_URL}/api/uploads/shops/${name}`, { headers: { Authorization: `Bearer ${token}` } })).status;

test('L8a: two Delivery Agents cannot reach each other\'s shops or deliveries', async (t) => {
  const { A, B } = await setup(t);
  for (const [me, label] of [[A, 'DA 50'], [B, 'second DA']]) {
    // Shop list
    const list = await api('/api/shops', { token: me.token });
    assert.equal(list.status, 200, label);
    assert.ok(shopIds(list.json).has(me.shop), `${label} lists own delivery shop ${me.shop}`);
    assert.ok(!shopIds(list.json).has(me.otherShop), `${label} does not list the other agent's shop ${me.otherShop}`);

    // Order history
    assert.equal((await api(`/api/shops/${me.shop}/order-history`, { token: me.token })).status, 200, `${label} own history`);
    const otherHistory = await api(`/api/shops/${me.otherShop}/order-history`, { token: me.token });
    assert.equal(otherHistory.status, 403, `${label} other agent's history`);
    assert.equal(otherHistory.json.code, 'FORBIDDEN');

    // Shop photos
    assert.equal(await photoStatus(me.token, me.photo), 200, `${label} own shop photo`);
    assert.equal(await photoStatus(me.token, me.otherPhoto), 403, `${label} other agent's shop photo`);

    // Deliveries and orders
    const deliveries = await api('/api/delivery/orders', { token: me.token });
    assert.equal(deliveries.status, 200);
    const delivered = (deliveries.json.orders || []).map((o) => o.orderId || o.id);
    assert.ok(delivered.includes(me.order), `${label} sees own delivery`);
    assert.ok(!delivered.includes(me.otherOrder), `${label} does not see the other delivery`);
    const orders = await api('/api/orders', { token: me.token });
    assert.ok(orders.json.orders.every((o) => Number(o.deliveryAgentId) === me.id), `${label} /api/orders only own`);
    assert.equal((await api(`/api/delivery/orders?agentId=${me.id === A.id ? B.id : A.id}`, { token: me.token })).status, 403);
    const update = await api(`/api/delivery/orders/${encodeURIComponent(me.otherOrder)}/status`, { token: me.token, method: 'POST', body: { status: 'Picked up' } });
    assert.equal(update.status, 403, `${label} cannot update the other delivery`);
  }
  const unchanged = await db.query('SELECT status FROM orders WHERE order_id IN ($1, $2)', [A.order, B.order]);
  assert.ok(unchanged.rows.every((r) => r.status === 'In progress'), 'no delivery was changed by the other agent');
});

/** Shop list, order history and photo for one agent and one shop: [listed, historyStatus, photoStatus]. */
async function shopAccess(me, shopId, photo) {
  return [
    shopIds((await api('/api/shops', { token: me.token })).json).has(shopId),
    (await api(`/api/shops/${shopId}/order-history`, { token: me.token })).status,
    await photoStatus(me.token, photo)
  ];
}

test('L7: historical access to an assigned shop survives every closed status, for list, history and photo', async (t) => {
  const { A } = await setup(t);
  assert.deepEqual(await shopAccess(A, A.shop, A.photo), [true, 200, 200], 'open delivery');
  for (const status of ['Picked up', 'Could not deliver', 'Pending', 'Delivered', 'Cancelled', 'Rejected']) {
    await db.query('UPDATE orders SET status = $1 WHERE order_id = $2', [status, A.order]);
    assert.deepEqual(await shopAccess(A, A.shop, A.photo), [true, 200, 200], `${status}: access kept`);
    // The delivery record itself stays in the agent's delivery list
    const row = ((await api('/api/delivery/orders', { token: A.token })).json.orders || []).find((o) => (o.orderId || o.id) === A.order);
    assert.ok(row && row.shopName, `${status}: delivery still listed with its shop`);
  }
  // A shop never assigned to this agent is still refused
  // (the photo check refuses on shop access before looking for the file, so no file is needed)
  assert.deepEqual(await shopAccess(A, 36, `shop_36_${crypto.randomUUID()}.jpg`), [false, 403, 403], 'never-assigned shop 36');
});

test('L7: after all deliveries at both shops close, each agent keeps its own history and still cannot reach the other', async (t) => {
  const { A, B } = await setup(t);
  for (const [order, status] of [[A.order, 'Delivered'], [B.order, 'Cancelled']]) {
    await db.query('UPDATE orders SET status = $1 WHERE order_id = $2', [status, order]);
  }
  for (const [me, label] of [[A, 'DA 50'], [B, 'second DA']]) {
    assert.deepEqual(await shopAccess(me, me.shop, me.photo), [true, 200, 200], `${label}: own closed shop`);
    assert.deepEqual(await shopAccess(me, me.otherShop, me.otherPhoto), [false, 403, 403], `${label}: other agent's closed shop`);
  }
  // Closing deliveries changed nothing else: assignment and status are exactly what was set
  const rows = (await db.query('SELECT order_id, status, delivery_agent_id FROM orders WHERE order_id IN ($1, $2) ORDER BY order_id', [A.order, B.order])).rows;
  assert.deepEqual(rows.map((r) => [r.status, Number(r.delivery_agent_id)]), [['Delivered', A.id], ['Cancelled', B.id]]);
});
