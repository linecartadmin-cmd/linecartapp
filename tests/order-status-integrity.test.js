/**
 * Order status integrity: stale offline updates and concurrent cancellations must not reopen or
 * overwrite a closed order (bug found in the Delivery Agent emulator walkthrough, 23 Nov 2026:
 * a queued pick-up moved an admin-cancelled order from 'Cancelled' to 'Picked up').
 *
 * Owner decisions implemented here:
 *  1. Cancelled is terminal for Delivery Agents.
 *  3. Agents cannot move Picked up back to Pending or In progress.
 *  4. Could not deliver requires the order to have been Picked up.
 *  5. Ordinary cancellation only before pick-up; Delivered / Could not deliver cannot be cancelled;
 *     payment records are preserved.
 *  6. Admin status edits accept only recognised statuses and valid transitions.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { db } from '../server/db.js';
import { initTestDb, tokenFor, api } from './helpers/session.mjs';

const PREFIX = 'TEST-INTEG-';
let seq = 0;
let deliveryUser;
let agentUser;
let T = {};

async function insertOrder({ status = 'In progress', total = 500, collected = 0, deliveryAgentId } = {}) {
  seq += 1;
  const orderId = `${PREFIX}${Date.now().toString(36)}-${seq}`;
  const serial = 950000 + Math.floor(Math.random() * 40000);
  await db.query(
    `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, sperson_id, agent_name, cluster_id,
                         order_date, created_at, status, items_count, total, delivery_agent_id,
                         payment_status, payment_amount_collected, payment_balance_due)
     VALUES ($1, $2, 'S101', 101, 'Integrity Test Shop', $3, 'Agent', 1, '2026-11-23', '2026-11-23T08:00:00Z',
             $4, 1, $5, $6, $7, $8, $9)`,
    [orderId, serial, agentUser.id, status, total, deliveryAgentId ?? deliveryUser.id,
      collected >= total && total > 0 ? 'Collected' : collected > 0 ? 'Partially collected' : 'Not collected',
      collected, Math.max(0, total - collected)]
  );
  return orderId;
}

const statusOf = async (orderId) => (await db.query('SELECT status FROM orders WHERE order_id = $1', [orderId])).rows[0]?.status;
const paymentOf = async (orderId) => {
  const r = (await db.query('SELECT payment_status, payment_amount_collected, payment_balance_due FROM orders WHERE order_id = $1', [orderId])).rows[0];
  return { status: r.payment_status, collected: Number(r.payment_amount_collected), balance: Number(r.payment_balance_due) };
};
const audit = async (orderId) =>
  (await db.query('SELECT action, details FROM audit_logs WHERE target_id = $1 ORDER BY id ASC', [orderId])).rows;

const deliver = (orderId, body, token = T.delivery) =>
  api(`/api/delivery/orders/${encodeURIComponent(orderId)}/status`, { token, method: 'POST', body });
const cancel = (orderId, reason = 'Integrity test cancellation') =>
  api(`/api/admin/orders/${encodeURIComponent(orderId)}/cancel`, { token: T.admin, method: 'POST', body: { reason } });
const adminEdit = (orderId, body) =>
  api(`/api/admin/orders/${encodeURIComponent(orderId)}`, { token: T.admin, method: 'PUT', body });

before(async () => {
  await initTestDb();
  const users = (await db.query('SELECT id, role FROM users WHERE active = 1 ORDER BY id ASC')).rows;
  deliveryUser = users.find((u) => String(u.role).toLowerCase() === 'delivery agent');
  agentUser = users.find((u) => String(u.role).toLowerCase() === 'field sales agent');
  const adminUser = users.find((u) => String(u.role).toLowerCase() === 'admin');
  assert.ok(deliveryUser && agentUser && adminUser, 'fixture users exist');
  T = { delivery: await tokenFor(deliveryUser.id), admin: await tokenFor(adminUser.id) };
});

after(async () => {
  await db.query(`DELETE FROM audit_logs WHERE target_id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM orders WHERE order_id LIKE '${PREFIX}%'`);
});

describe('Legitimate delivery workflow keeps working', () => {
  test('1. pick up an active order', async () => {
    const id = await insertOrder({ status: 'In progress' });
    const r = await deliver(id, { status: 'Picked up' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(await statusOf(id), 'Picked up');
  });

  test('2. deliver a picked-up order with part payment', async () => {
    const id = await insertOrder({ status: 'Picked up', total: 500 });
    const r = await deliver(id, { status: 'Delivered', paymentAmountCollected: 200 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(await statusOf(id), 'Delivered');
    assert.deepStrictEqual(await paymentOf(id), { status: 'Partially collected', collected: 200, balance: 300 });
  });

  test('3. not delivered after pick-up, with a reason', async () => {
    const id = await insertOrder({ status: 'Picked up' });
    const r = await deliver(id, { status: 'Could not deliver', reason: 'Shop Closed' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(await statusOf(id), 'Could not deliver');
  });

  test('4. admin cancels an order before pick-up', async () => {
    const id = await insertOrder({ status: 'In progress' });
    const r = await cancel(id);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(await statusOf(id), 'Cancelled');
  });

  test('replaying the same accepted update is still an idempotent success', async () => {
    const id = await insertOrder({ status: 'Picked up' });
    assert.strictEqual((await deliver(id, { status: 'Delivered', paymentAmountCollected: 500 })).status, 200);
    const replay = await deliver(id, { status: 'Delivered', paymentAmountCollected: 500 });
    assert.strictEqual(replay.status, 200);
    assert.strictEqual(replay.json.idempotentReplay, true);
  });
});

describe('Stale offline updates cannot reopen a cancelled order', () => {
  test('5. pick-up queued before cancellation, replayed after it: 409, order stays Cancelled', async () => {
    const id = await insertOrder({ status: 'In progress' });
    assert.strictEqual((await cancel(id)).status, 200);
    // The offline app replays what it queued earlier (old app versions send no expectedStatus)
    const r = await deliver(id, { status: 'Picked up', deviceEventTime: '2026-11-23T08:00:00Z' });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.code, 'STATUS_CONFLICT');
    assert.strictEqual(r.json.currentStatus, 'Cancelled');
    assert.strictEqual(r.json.requestedStatus, 'Picked up');
    assert.ok(r.json.message && /cancel/i.test(r.json.message));
    assert.strictEqual(await statusOf(id), 'Cancelled');
  });

  test('6. delivery queued before cancellation, replayed after it: 409, payment untouched', async () => {
    const id = await insertOrder({ status: 'In progress', total: 400 });
    assert.strictEqual((await cancel(id)).status, 200);
    const r = await deliver(id, { status: 'Delivered', paymentAmountCollected: 400 });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(await statusOf(id), 'Cancelled');
    assert.deepStrictEqual(await paymentOf(id), { status: 'Not collected', collected: 0, balance: 400 });
  });

  test('7. any agent update against an already cancelled order is refused', async () => {
    const id = await insertOrder({ status: 'Cancelled' });
    for (const body of [{ status: 'Picked up' }, { status: 'Delivered' }, { status: 'Could not deliver', reason: 'Shop Closed' }, { status: 'In progress' }, { status: 'Pending' }]) {
      const r = await deliver(id, body);
      assert.strictEqual(r.status, 409, `${body.status} refused`);
      assert.strictEqual(await statusOf(id), 'Cancelled');
    }
  });

  test('new apps: expectedStatus that no longer matches the order is refused as stale', async () => {
    const id = await insertOrder({ status: 'Picked up' });
    const r = await deliver(id, { status: 'Could not deliver', reason: 'Shop Closed', expectedStatus: 'In progress' });
    // Picked up -> Could not deliver is valid, but the device acted on an older status
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.code, 'STALE_UPDATE');
    assert.strictEqual(r.json.currentStatus, 'Picked up');
    assert.strictEqual(await statusOf(id), 'Picked up');
  });

  test('expectedStatus Pending and In progress are treated as the same "awaiting pick-up" state', async () => {
    const id = await insertOrder({ status: 'Pending' });
    const r = await deliver(id, { status: 'Picked up', expectedStatus: 'In progress' });
    assert.strictEqual(r.status, 200);
  });
});

describe('Lifecycle rules (owner decisions)', () => {
  test('agents cannot move Picked up back to Pending or In progress', async () => {
    const id = await insertOrder({ status: 'Picked up' });
    for (const s of ['Pending', 'In progress']) {
      const r = await deliver(id, { status: s });
      assert.strictEqual(r.status, 409, s);
    }
    assert.strictEqual(await statusOf(id), 'Picked up');
  });

  test('Could not deliver requires pick-up first', async () => {
    const id = await insertOrder({ status: 'In progress' });
    const r = await deliver(id, { status: 'Could not deliver', reason: 'Shop Closed' });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(await statusOf(id), 'In progress');
  });

  test('Delivered and Could not deliver stay final for agents', async () => {
    for (const from of ['Delivered', 'Could not deliver']) {
      const id = await insertOrder({ status: from });
      const r = await deliver(id, { status: 'Picked up' });
      assert.strictEqual(r.status, 409, from);
      assert.strictEqual(await statusOf(id), from);
    }
  });

  test('cancellation is refused after pick-up and on Delivered / Could not deliver; payment is preserved', async () => {
    for (const from of ['Picked up', 'Delivered', 'Could not deliver']) {
      const id = await insertOrder({ status: from, total: 600, collected: from === 'Delivered' ? 250 : 0 });
      const before = await paymentOf(id);
      const r = await cancel(id);
      assert.strictEqual(r.status, 409, from);
      assert.strictEqual(r.json.currentStatus, from);
      assert.strictEqual(r.json.requestedStatus, 'Cancelled');
      assert.strictEqual(await statusOf(id), from);
      assert.deepStrictEqual(await paymentOf(id), before);
    }
  });

  test('cancelling an already cancelled order is an idempotent success', async () => {
    const id = await insertOrder({ status: 'Cancelled' });
    const r = await cancel(id);
    assert.strictEqual(r.status, 200);
  });

  test('admin edit accepts only recognised statuses', async () => {
    const id = await insertOrder({ status: 'In progress' });
    const r = await adminEdit(id, { status: 'Shipped somewhere' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(await statusOf(id), 'In progress');
  });

  test('admin edit refuses invalid transitions and cannot reopen a cancelled order', async () => {
    const cases = [
      ['Cancelled', 'In progress'],
      ['Cancelled', 'Picked up'],
      ['Delivered', 'In progress'],
      ['Could not deliver', 'Picked up'],
      ['Picked up', 'In progress'],
      ['Picked up', 'Cancelled'],
      ['In progress', 'Could not deliver']
    ];
    for (const [from, to] of cases) {
      const id = await insertOrder({ status: from });
      const r = await adminEdit(id, { status: to });
      assert.strictEqual(r.status, 409, `${from} -> ${to}`);
      assert.strictEqual(r.json.currentStatus, from);
      assert.strictEqual(r.json.requestedStatus, to);
      assert.strictEqual(await statusOf(id), from);
    }
  });

  test('admin edit keeps valid office transitions and line edits without a status change', async () => {
    const a = await insertOrder({ status: 'In progress' });
    assert.strictEqual((await adminEdit(a, { status: 'Delivered' })).status, 200);
    assert.strictEqual(await statusOf(a), 'Delivered');
    const b = await insertOrder({ status: 'Picked up' });
    assert.strictEqual((await adminEdit(b, { status: 'Could not deliver' })).status, 200);
    const c = await insertOrder({ status: 'Cancelled' });
    assert.strictEqual((await adminEdit(c, { notes: 'note only' })).status, 200, 'no status change is allowed');
    assert.strictEqual(await statusOf(c), 'Cancelled');
  });
});

describe('Concurrency: admin cancellation racing a Delivery Agent update', () => {
  test('9. exactly one of the two wins and the final status matches the winner (20 rounds)', async () => {
    for (let i = 0; i < 20; i++) {
      const id = await insertOrder({ status: 'In progress' });
      const [c, p] = await Promise.all([cancel(id), deliver(id, { status: 'Picked up' })]);
      const final = await statusOf(id);
      const winners = [c.status === 200 ? 'Cancelled' : null, p.status === 200 ? 'Picked up' : null].filter(Boolean);
      assert.strictEqual(winners.length, 1, `round ${i}: one winner (cancel ${c.status}, pickup ${p.status})`);
      assert.strictEqual(final, winners[0], `round ${i}: final status is the winner's`);
      const loser = c.status === 200 ? p : c;
      assert.strictEqual(loser.status, 409, `round ${i}: loser gets 409`);
    }
  });

  test('a cancelled order is never overwritten by an agent update racing a second admin cancel', async () => {
    for (let i = 0; i < 10; i++) {
      const id = await insertOrder({ status: 'In progress' });
      await Promise.all([cancel(id), deliver(id, { status: 'Picked up' }), deliver(id, { status: 'Picked up' })]);
      const final = await statusOf(id);
      assert.ok(['Cancelled', 'Picked up'].includes(final));
      const log = await audit(id);
      const accepted = log.filter((l) => ['UPDATE_DELIVERY_STATUS', 'ORDER_CANCELLED'].includes(l.action));
      const lastAccepted = accepted[accepted.length - 1];
      assert.ok(!log.some((l) => l.action === 'UPDATE_DELIVERY_STATUS' && l.details.includes("from 'Cancelled'")), `round ${i}: no update from Cancelled`);
      assert.ok(lastAccepted, `round ${i}: something was accepted`);
    }
  });
});

describe('Audit trail', () => {
  test('10. accepted and rejected transitions are both recorded accurately', async () => {
    const id = await insertOrder({ status: 'In progress' });
    assert.strictEqual((await cancel(id, 'Office cancel for audit test')).status, 200);
    assert.strictEqual((await deliver(id, { status: 'Picked up', deviceEventTime: '2026-11-23T07:59:00Z' })).status, 409);
    const log = await audit(id);
    const cancelled = log.filter((l) => l.action === 'ORDER_CANCELLED');
    const rejected = log.filter((l) => l.action === 'DELIVERY_STATUS_REJECTED');
    assert.strictEqual(cancelled.length, 1);
    assert.match(cancelled[0].details, /previous status: 'In progress'/);
    assert.strictEqual(rejected.length, 1);
    assert.match(rejected[0].details, /'Cancelled'/);
    assert.match(rejected[0].details, /'Picked up'/);
    assert.match(rejected[0].details, /deviceEventTime: 2026-11-23T07:59:00Z/);
    assert.ok(!log.some((l) => l.action === 'UPDATE_DELIVERY_STATUS'), 'no accepted delivery update recorded');
  });
});
