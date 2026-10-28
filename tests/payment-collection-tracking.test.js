/**
 * Payment Collection Tracking Verification Test Suite
 * 
 * Verifies:
 * 1. Delivery completion is kept strictly separate from payment status (Delivered can be Collected, Partially collected, or Not collected).
 * 2. Delivery agent flow:
 *    - "No": saves ₹0 collected, marks payment as 'Not collected'.
 *    - "Yes": records collected amount, partial payments, and balance due.
 * 3. Exact formatting examples:
 *    - Delivered · Collected ₹500 of ₹500 · Balance ₹0
 *    - Delivered · Partially collected ₹200 of ₹500 · Balance ₹300
 *    - Delivered · Not collected · Balance ₹500
 * 4. Data & Validation:
 *    - Amount collected between ₹0 and order total; reject negative or exceeding amounts.
 *    - Idempotency & safe retry without double collection.
 *    - Records collector user ID, name, and timestamp.
 *    - Preserves existing orders as 'Not collected'.
 *    - Role enforcement (assigned delivery agent vs unauthorized).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { db, runMigrationsAndSeed, loadDatabaseState } from '../server/db.js';
import * as seedData from '../server/data.loader.js';
import { getPaymentSummary } from '../client/src/utils.js';

describe('Payment Collection Tracking Verification Suite', async () => {
  let deliveryUser = null;
  let otherDeliveryUser = null;
  let adminUser = null;
  let managerUser = null;
  let agentUser = null;

  let deliveryToken = null;
  let otherDeliveryToken = null;
  let adminToken = null;

  const API_PORT = process.env.PORT || 3001;
  const BASE_URL = `http://localhost:${API_PORT}`;

  let serialSeq = 91000;
  const insertTestOrder = async ({ orderId, total = 500, deliveryAgentId = null, status = 'Picked up' }) => {
    serialSeq++;
    await db.query(
      `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, sperson_id, agent_name, cluster_id, order_date, created_at, status, items_count, total, delivery_agent_id, payment_status, payment_amount_collected, payment_balance_due)
       VALUES ($1, $2, 'S101', 101, 'Test Shop 101', $3, 'Agent 1', 1, '2026-10-28', '2026-10-28T10:00:00Z', $4, 1, $5, $6, 'Not collected', 0, $5)`,
      [orderId, serialSeq, agentUser.id, status, total, deliveryAgentId || deliveryUser.id]
    );
  };

  const createTestSession = async (user) => {
    const rawToken = 'test-token-' + user.id + '-' + crypto.randomBytes(16).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = Date.now();
    const expiresAt = now + 24 * 3600 * 1000;
    await db.query(
      `INSERT INTO sessions (token_hash, user_id, role, is_dev_admin, created_at, last_seen, expires_at, revoked_at)
       VALUES ($1, $2, $3, 0, $4, $5, $6, NULL)`,
      [tokenHash, user.id, user.role, now, now, expiresAt]
    );
    return rawToken;
  };

  before(async () => {
    await db.init();
    await runMigrationsAndSeed({
      seedData,
      isProduction: false
    });

    const usersRes = await db.query('SELECT * FROM users ORDER BY id ASC');
    const users = usersRes.rows;

    deliveryUser = users.find(u => (u.role || '').toLowerCase() === 'delivery agent');
    adminUser = users.find(u => (u.role || '').toLowerCase() === 'admin');
    managerUser = users.find(u => (u.role || '').toLowerCase() === 'sales manager');
    agentUser = users.find(u => (u.role || '').toLowerCase() === 'field sales agent');

    let otherDeliv = users.filter(u => (u.role || '').toLowerCase() === 'delivery agent')[1];
    if (!otherDeliv) {
      const ins = await db.query(
        `INSERT INTO users (name, role, phone, phone_valid, active, password_hash, created_on)
         VALUES ('Other Delivery Agent', 'Delivery Agent', '9999988888', 1, 1, 'hash', datetime('now'))
         RETURNING *`
      );
      otherDeliv = ins.rows[0];
    }
    otherDeliveryUser = otherDeliv;

    deliveryToken = await createTestSession(deliveryUser);
    otherDeliveryToken = await createTestSession(otherDeliveryUser);
    adminToken = await createTestSession(adminUser);
  });

  after(async () => {
    await db.query("DELETE FROM price_requests WHERE order_id NOT IN ('S101-24019')");
    await db.query("DELETE FROM order_items WHERE order_id NOT IN ('S101-24019')");
    await db.query("DELETE FROM orders WHERE order_id NOT IN ('S101-24019')");
    await db.close();
  });

  test('1. Helper getPaymentSummary produces exact required formatting strings', () => {
    // Example 1: Delivered · Collected ₹500 of ₹500 · Balance ₹0
    const summary1 = getPaymentSummary({
      status: 'Delivered',
      total: 500,
      paymentStatus: 'Collected',
      paymentAmountCollected: 500,
      paymentBalanceDue: 0
    });
    assert.strictEqual(summary1.fullText, 'Delivered · Collected ₹500 of ₹500 · Balance ₹0');
    assert.strictEqual(summary1.summaryText, 'Collected ₹500 of ₹500 · Balance ₹0');
    assert.strictEqual(summary1.paymentStatus, 'Collected');
    assert.strictEqual(summary1.balance, 0);

    // Example 2: Delivered · Partially collected ₹200 of ₹500 · Balance ₹300
    const summary2 = getPaymentSummary({
      status: 'Delivered',
      total: 500,
      paymentStatus: 'Partially collected',
      paymentAmountCollected: 200,
      paymentBalanceDue: 300
    });
    assert.strictEqual(summary2.fullText, 'Delivered · Partially collected ₹200 of ₹500 · Balance ₹300');
    assert.strictEqual(summary2.summaryText, 'Partially collected ₹200 of ₹500 · Balance ₹300');
    assert.strictEqual(summary2.paymentStatus, 'Partially collected');
    assert.strictEqual(summary2.balance, 300);

    // Example 3: Delivered · Not collected · Balance ₹500
    const summary3 = getPaymentSummary({
      status: 'Delivered',
      total: 500,
      paymentStatus: 'Not collected',
      paymentAmountCollected: 0,
      paymentBalanceDue: 500
    });
    assert.strictEqual(summary3.fullText, 'Delivered · Not collected · Balance ₹500');
    assert.strictEqual(summary3.summaryText, 'Not collected · Balance ₹500');
    assert.strictEqual(summary3.paymentStatus, 'Not collected');
    assert.strictEqual(summary3.balance, 500);
  });

  test('2. Existing orders are preserved with default Not collected status and full balance due', async () => {
    const existing = await db.query("SELECT * FROM orders WHERE order_id = 'S101-24019'");
    assert.ok(existing.rows.length > 0, 'Seed order S101-24019 should exist');
    const order = existing.rows[0];

    assert.strictEqual(order.payment_status, 'Not collected');
    assert.strictEqual(Number(order.payment_amount_collected || 0), 0);
    assert.strictEqual(Number(order.payment_balance_due), Number(order.total));
  });

  test('3. Delivery flow - "No" at shop saves ₹0 collected and Not collected status', async () => {
    const orderId = 'TEST-DELIV-NO-01';
    await insertTestOrder({ orderId, total: 500, deliveryAgentId: deliveryUser.id });

    const res = await fetch(`${BASE_URL}/api/delivery/orders/${orderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deliveryToken}`
      },
      body: JSON.stringify({
        status: 'Delivered',
        paymentAmountCollected: 0
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 200);
    assert.strictEqual(data.order.status, 'Delivered');
    assert.strictEqual(data.order.paymentStatus, 'Not collected');
    assert.strictEqual(data.order.paymentAmountCollected, 0);
    assert.strictEqual(data.order.paymentBalanceDue, 500);
    assert.strictEqual(data.order.paymentCollectedBy, deliveryUser.id);
    assert.strictEqual(data.order.paymentCollectedByName, deliveryUser.name);

    // Verify in DB directly
    const dbCheck = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
    const row = dbCheck.rows[0];
    assert.strictEqual(row.status, 'Delivered');
    assert.strictEqual(row.payment_status, 'Not collected');
    assert.strictEqual(Number(row.payment_amount_collected), 0);
    assert.strictEqual(Number(row.payment_balance_due), 500);
    assert.strictEqual(row.payment_collected_by, deliveryUser.id);
  });

  test('4. Delivery flow - "Yes" with full amount collected marks order Delivered and payment Collected', async () => {
    const orderId = 'TEST-DELIV-FULL-02';
    await insertTestOrder({ orderId, total: 500, deliveryAgentId: deliveryUser.id });

    const res = await fetch(`${BASE_URL}/api/delivery/orders/${orderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deliveryToken}`
      },
      body: JSON.stringify({
        status: 'Delivered',
        paymentAmountCollected: 500
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.order.status, 'Delivered');
    assert.strictEqual(data.order.paymentStatus, 'Collected');
    assert.strictEqual(data.order.paymentAmountCollected, 500);
    assert.strictEqual(data.order.paymentBalanceDue, 0);

    const dbCheck = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
    const row = dbCheck.rows[0];
    assert.strictEqual(row.status, 'Delivered');
    assert.strictEqual(row.payment_status, 'Collected');
    assert.strictEqual(Number(row.payment_amount_collected), 500);
    assert.strictEqual(Number(row.payment_balance_due), 0);
  });

  test('5. Delivery flow - "Yes" with partial amount collected marks order Delivered and payment Partially collected', async () => {
    const orderId = 'TEST-DELIV-PARTIAL-03';
    await insertTestOrder({ orderId, total: 500, deliveryAgentId: deliveryUser.id });

    const res = await fetch(`${BASE_URL}/api/delivery/orders/${orderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deliveryToken}`
      },
      body: JSON.stringify({
        status: 'Delivered',
        paymentAmountCollected: 200
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.order.status, 'Delivered');
    assert.strictEqual(data.order.paymentStatus, 'Partially collected');
    assert.strictEqual(data.order.paymentAmountCollected, 200);
    assert.strictEqual(data.order.paymentBalanceDue, 300);

    const dbCheck = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
    const row = dbCheck.rows[0];
    assert.strictEqual(row.payment_status, 'Partially collected');
    assert.strictEqual(Number(row.payment_amount_collected), 200);
    assert.strictEqual(Number(row.payment_balance_due), 300);
  });

  test('6. Validation rejects negative payment amounts (HTTP 400)', async () => {
    const orderId = 'TEST-VAL-NEG';
    await insertTestOrder({ orderId, total: 500, deliveryAgentId: deliveryUser.id });

    const res = await fetch(`${BASE_URL}/api/delivery/orders/${orderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deliveryToken}`
      },
      body: JSON.stringify({
        status: 'Delivered',
        paymentAmountCollected: -50
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.message.includes('non-negative'));
  });

  test('7. Validation rejects payment amounts exceeding order total (HTTP 400)', async () => {
    const orderId = 'TEST-VAL-EXCEED';
    await insertTestOrder({ orderId, total: 500, deliveryAgentId: deliveryUser.id });

    const res = await fetch(`${BASE_URL}/api/delivery/orders/${orderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deliveryToken}`
      },
      body: JSON.stringify({
        status: 'Delivered',
        paymentAmountCollected: 600
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.message.includes('cannot exceed order total'));
  });

  test('8. Idempotent retry does not duplicate collection or corrupt balances', async () => {
    const orderId = 'TEST-IDEMP-01';
    await insertTestOrder({ orderId, total: 500, deliveryAgentId: deliveryUser.id });

    // First call
    const res1 = await fetch(`${BASE_URL}/api/delivery/orders/${orderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deliveryToken}`
      },
      body: JSON.stringify({
        status: 'Delivered',
        paymentAmountCollected: 300
      })
    });
    assert.strictEqual(res1.status, 200);

    // Second call (network retry)
    const res2 = await fetch(`${BASE_URL}/api/delivery/orders/${orderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deliveryToken}`
      },
      body: JSON.stringify({
        status: 'Delivered',
        paymentAmountCollected: 300
      })
    });
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.strictEqual(data2.idempotentReplay, true);
    assert.strictEqual(data2.order.paymentAmountCollected, 300);
    assert.strictEqual(data2.order.paymentBalanceDue, 200);

    // Direct DB check
    const dbCheck = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
    assert.strictEqual(Number(dbCheck.rows[0].payment_amount_collected), 300);
    assert.strictEqual(Number(dbCheck.rows[0].payment_balance_due), 200);
  });

  test('9. Role permissions block unauthorized delivery agents from recording collection on unassigned orders (HTTP 403)', async () => {
    const orderId = 'TEST-UNAUTH-01';
    await insertTestOrder({ orderId, total: 500, deliveryAgentId: deliveryUser.id });

    const res = await fetch(`${BASE_URL}/api/delivery/orders/${orderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${otherDeliveryToken}`
      },
      body: JSON.stringify({
        status: 'Delivered',
        paymentAmountCollected: 500
      })
    });

    assert.strictEqual(res.status, 403);
  });

  test('10. Order views: GET /api/orders and GET /api/delivery/orders return payment collection fields', async () => {
    const res = await fetch(`${BASE_URL}/api/orders?clusterId=1`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.orders));
    const sample = data.orders.find(o => o.id === 'TEST-DELIV-PARTIAL-03');
    assert.ok(sample, 'Partial order should be listed in orders API');
    assert.strictEqual(sample.paymentStatus, 'Partially collected');
    assert.strictEqual(sample.paymentAmountCollected, 200);
    assert.strictEqual(sample.paymentBalanceDue, 300);
  });
});
