import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { db, runMigrationsAndSeed, loadDatabaseState } from '../server/db.js';
import * as seedData from '../server/data.loader.js';

describe('Price Approval Queue & 7-Day Shop Order History Verification', async () => {
  let adminUser = null;
  let managerUser = null;
  let otherManagerUser = null;
  let agentUser = null;
  let otherAgentUser = null;

  let adminToken = null;
  let managerToken = null;
  let otherManagerToken = null;
  let agentToken = null;
  let otherAgentToken = null;

  const createTestSession = async (user) => {
    const rawToken = 'test-tok-' + user.id + '-' + crypto.randomBytes(16).toString('hex');
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
      isProduction: false,
      defaultRolePermissions: {
        Admin: { pages: ['items', 'admin-dashboard', 'manager-orders', 'price-requests'], actions: ['manage_items', 'approve_price_requests'] },
        'Sales Manager': { pages: ['items', 'manager-orders', 'price-requests'], actions: ['view_items', 'approve_price_requests'] },
        'Field Sales Agent': { pages: ['overview', 'orders'], actions: ['create_order'] }
      }
    });

    const state = await loadDatabaseState();
    adminUser = state.users.find((u) => (u.role || '').toLowerCase() === 'admin');
    managerUser = state.users.find((u) => (u.role || '').toLowerCase() === 'sales manager');
    agentUser = state.users.find((u) => (u.role || '').toLowerCase() === 'field sales agent' && Number(u.id) === 1)
      || state.users.find((u) => (u.role || '').toLowerCase() === 'field sales agent');

    // Create a second manager with a different cluster
    const otherMgrRes = await db.query(
      `INSERT INTO users (name, password_hash, role, active, created_on, cluster_id)
       VALUES ('Out-of-Scope Manager', 'hash', 'Sales Manager', 1, datetime('now'), 99)
       RETURNING id, name, role, cluster_id`
    );
    otherManagerUser = otherMgrRes.rows[0];

    // Create a second agent assigned to otherManagerUser
    const otherAgentRes = await db.query(
      `INSERT INTO users (name, password_hash, role, active, created_on, cluster_id)
       VALUES ('Other Agent', 'hash', 'Field Sales Agent', 1, datetime('now'), 99)
       RETURNING id, name, role, cluster_id`
    );
    otherAgentUser = otherAgentRes.rows[0];

    // Ensure managerUser supervises agentUser
    await db.query(
      `INSERT OR REPLACE INTO manager_assignments (manager_id, agent_id)
       VALUES ($1, $2)`,
      [managerUser.id, agentUser.id]
    );

    adminToken = await createTestSession(adminUser);
    managerToken = await createTestSession(managerUser);
    otherManagerToken = await createTestSession(otherManagerUser);
    agentToken = await createTestSession(agentUser);
    otherAgentToken = await createTestSession(otherAgentUser);

    // Assign shop 101 to agentUser via Admin API
    await fetch('http://localhost:3001/api/shops/101/assign', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ agentId: agentUser.id })
    });
  });

  after(async () => {
    await db.query("DELETE FROM price_requests WHERE order_id LIKE 'TEST-%'");
    await db.query("DELETE FROM order_items WHERE order_id LIKE 'TEST-%'");
    await db.query("DELETE FROM orders WHERE order_id LIKE 'TEST-%'");
    await db.close();
  });

  // ===========================================================================
  // Feature 1: Customer Price Approval Requests Queue & Scoping
  // ===========================================================================
  describe('1. Price Approval Request Submission & Visibility Queue', () => {
    let testOrderId = null;
    let pendingRequestId = null;

    test('Agent creates order with custom requested price -> order is "Price approval pending" and request is created in queue', async () => {
      const orderPayload = {
        idempotencyKey: 'pr-test-' + Date.now(),
        orderList: [
          {
            itemid: 1,
            itemName: 'Onio Medium',
            qty: 5,
            price: 53.0,
            catalogPrice: 53.0,
            actprice: 53.0,
            custprice: 42.0,
            requestedPrice: 42.0,
            requestReason: 'Bulk discount request for restaurant opening',
            customerid: 101,
            clusterid: 1,
            spersonid: agentUser.id
          }
        ]
      };

      const res = await fetch('http://localhost:3001/api/linecart/createorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`
        },
        body: JSON.stringify(orderPayload)
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 200);
      assert.strictEqual(data.priceApprovalPending, true);
      assert.strictEqual(data.statusName, 'Price approval pending');
      testOrderId = data.orderId;

      // Check DB price_requests row
      const prRes = await db.query(
        `SELECT id, order_id, item_id, requested_price, catalog_price, status, reason
         FROM price_requests WHERE order_id = $1`,
        [testOrderId]
      );
      assert.strictEqual(prRes.rows.length, 1);
      assert.strictEqual(prRes.rows[0].status, 'pending');
      assert.strictEqual(Number(prRes.rows[0].requested_price), 42.0);
      assert.strictEqual(Number(prRes.rows[0].catalog_price), 53.0);
      pendingRequestId = prRes.rows[0].id;
    });

    test('Admin sees all pending requests in GET /api/price-requests with enriched shop, item, agent, and cluster details', async () => {
      const res = await fetch('http://localhost:3001/api/price-requests?status=pending', {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 200);
      assert(Array.isArray(data.priceRequests));
      assert(data.pendingCount >= 1);

      const target = data.priceRequests.find((p) => p.id === pendingRequestId);
      assert(target, 'Admin queue must include the created price request');
      assert.strictEqual(target.orderId, testOrderId);
      assert.strictEqual(Number(target.requestedPrice), 42.0);
      assert.strictEqual(Number(target.catalogPrice), 53.0);
      assert(target.shopName, 'Must include shopName');
      assert(target.itemName, 'Must include itemName');
      assert(target.agentName, 'Must include requesting agentName');
    });

    test('Assigned Sales Manager sees the request for their supervised agent and shop', async () => {
      const res = await fetch('http://localhost:3001/api/price-requests?status=pending', {
        headers: { Authorization: `Bearer ${managerToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const target = data.priceRequests.find((p) => p.id === pendingRequestId);
      assert(target, 'Assigned Sales Manager must see price request from their assigned agent');
    });

    test('Out-of-scope Sales Manager CANNOT see or access the request (scoped isolation)', async () => {
      const res = await fetch('http://localhost:3001/api/price-requests?status=pending', {
        headers: { Authorization: `Bearer ${otherManagerToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const target = data.priceRequests.find((p) => p.id === pendingRequestId);
      assert.strictEqual(target, undefined, 'Out-of-scope Sales Manager must NOT see price request from another team');
    });

    test('Requesting agent CANNOT self-approve their own price request (HTTP 403 Forbidden)', async () => {
      const res = await fetch(`http://localhost:3001/api/price-requests/${pendingRequestId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`
        },
        body: JSON.stringify({ action: 'approve' })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert(data.message.includes('Self-approval') || data.message.includes('Access Denied'));
    });

    test('Out-of-scope Sales Manager CANNOT approve or reject the request (HTTP 403 Forbidden)', async () => {
      const res = await fetch(`http://localhost:3001/api/price-requests/${pendingRequestId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherManagerToken}`
        },
        body: JSON.stringify({ action: 'approve' })
      });
      assert.strictEqual(res.status, 403);
    });
  });

  // ===========================================================================
  // Feature 2: Multi-Item Approval Rules & Decision Recording
  // ===========================================================================
  describe('2. Multi-Item Approval Rules & Decision Persistence', () => {
    let multiItemOrderId = null;
    let req1Id = null;
    let req2Id = null;

    test('Order with 2 custom requested items creates 2 pending price requests and remains pending after 1st decision', async () => {
      const multiPayload = {
        idempotencyKey: 'multi-pr-' + Date.now(),
        orderList: [
          {
            itemid: 1,
            itemName: 'Onio Medium',
            qty: 4,
            price: 53.0,
            requestedPrice: 40.0,
            requestReason: 'Volume tier 1',
            customerid: 101,
            clusterid: 1,
            spersonid: agentUser.id
          },
          {
            itemid: 2,
            itemName: 'Onion Big',
            qty: 3,
            price: 55.5,
            requestedPrice: 45.0,
            requestReason: 'Volume tier 2',
            customerid: 101,
            clusterid: 1,
            spersonid: agentUser.id
          }
        ]
      };

      const createRes = await fetch('http://localhost:3001/api/linecart/createorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`
        },
        body: JSON.stringify(multiPayload)
      });
      const createData = await createRes.json();
      assert.strictEqual(createRes.status, 200);
      multiItemOrderId = createData.orderId;

      const prRows = await db.query(
        `SELECT id, item_id FROM price_requests WHERE order_id = $1 ORDER BY item_id ASC`,
        [multiItemOrderId]
      );
      assert.strictEqual(prRows.rows.length, 2);
      req1Id = prRows.rows[0].id;
      req2Id = prRows.rows[1].id;

      // 1. Manager approves FIRST item only
      const dec1Res = await fetch(`http://localhost:3001/api/price-requests/${req1Id}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`
        },
        body: JSON.stringify({ action: 'approve', comment: 'Approved item 1 volume rate' })
      });
      assert.strictEqual(dec1Res.status, 200);

      // Verify order is STILL "Price approval pending" because item 2 is pending
      const checkOrder1 = await db.query(`SELECT status FROM orders WHERE order_id = $1`, [multiItemOrderId]);
      assert.strictEqual(checkOrder1.rows[0].status, 'Price approval pending', 'Order must stay pending until ALL items resolved');

      // 2. Manager rejects SECOND item
      const dec2Res = await fetch(`http://localhost:3001/api/price-requests/${req2Id}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`
        },
        body: JSON.stringify({ action: 'reject', comment: 'Margin too low for big onion' })
      });
      assert.strictEqual(dec2Res.status, 200);

      // Verify order transitions to "In progress" now that remaining pending is 0
      const checkOrder2 = await db.query(`SELECT status, total FROM orders WHERE order_id = $1`, [multiItemOrderId]);
      assert.strictEqual(checkOrder2.rows[0].status, 'In progress', 'Order must transition to In progress when all requests resolved');

      // Check recalculated total: 4 * 40.0 (item 1 approved) + 3 * 55.5 (item 2 rejected, kept catalog) = 160.0 + 166.5 = 326.5
      const expectedTotal = 4 * 40.0 + 3 * 55.5;
      assert.strictEqual(Number(checkOrder2.rows[0].total), expectedTotal);

      // Check decision details persisted
      const prCheck = await db.query(`SELECT decision_by, decision_by_name, decision_at, decision_comment FROM price_requests WHERE id = $1`, [req1Id]);
      assert.strictEqual(Number(prCheck.rows[0].decision_by), Number(managerUser.id));
      assert(prCheck.rows[0].decision_at);
      assert.strictEqual(prCheck.rows[0].decision_comment, 'Approved item 1 volume rate');
    });
  });

  // ===========================================================================
  // Feature 3: Rolling 7-Day Shop Order History
  // ===========================================================================
  describe('3. Rolling 7-Day Shop Order History Date-Range Filter', () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const threeDaysAgoIso = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const tenDaysAgoIso = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);

    before(async () => {
      // Create order 1: 3 days ago (INSIDE 7-day window)
      await db.query(
        `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, sperson_id, agent_name, cluster_id, order_date, created_at, status, items_count, total, payment_status, payment_amount_collected, payment_balance_due)
         VALUES ('TEST-ORD-3DAYS', 9901, 'S101', 101, 'Test Shop 101', $1, 'Agent 1', 1, $2, $3, 'In progress', 1, 106.0, 'Not collected', 0, 106.0)`,
        [agentUser.id, threeDaysAgoIso, `${threeDaysAgoIso}T10:00:00Z`]
      );
      await db.query(
        `INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, item_json)
         VALUES (99001, 'TEST-ORD-3DAYS', 1, 'Onio Medium', 2, 53.0, 53.0, 53.0, '{"unitType":"Kgs"}')`
      );

      // Create order 2: today (INSIDE 7-day window)
      await db.query(
        `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, sperson_id, agent_name, cluster_id, order_date, created_at, status, items_count, total, payment_status, payment_amount_collected, payment_balance_due)
         VALUES ('TEST-ORD-TODAY', 9902, 'S101', 101, 'Test Shop 101', $1, 'Agent 1', 1, $2, $3, 'Delivered', 1, 265.0, 'Collected', 265.0, 0)`,
        [agentUser.id, todayIso, `${todayIso}T11:00:00Z`]
      );
      await db.query(
        `INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, item_json)
         VALUES (99002, 'TEST-ORD-TODAY', 1, 'Onio Medium', 5, 53.0, 53.0, 53.0, '{"unitType":"Kgs"}')`
      );

      // Create order 3: 10 days ago (OUTSIDE rolling 7-day window)
      await db.query(
        `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, sperson_id, agent_name, cluster_id, order_date, created_at, status, items_count, total, payment_status, payment_amount_collected, payment_balance_due)
         VALUES ('TEST-ORD-10DAYS', 9903, 'S101', 101, 'Test Shop 101', $1, 'Agent 1', 1, $2, $3, 'Delivered', 1, 530.0, 'Collected', 530.0, 0)`,
        [agentUser.id, tenDaysAgoIso, `${tenDaysAgoIso}T09:00:00Z`]
      );
      await db.query(
        `INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, item_json)
         VALUES (99003, 'TEST-ORD-10DAYS', 1, 'Onio Medium', 10, 53.0, 53.0, 53.0, '{"unitType":"Kgs"}')`
      );
    });

    test('GET /api/shops/:shopId/order-history?days=7 returns orders strictly within rolling 7-day period', async () => {
      const res = await fetch('http://localhost:3001/api/shops/101/order-history?days=7', {
        headers: { Authorization: `Bearer ${agentToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 200);
      assert.strictEqual(data.shop.shopId, 101);
      assert.strictEqual(data.period.days, 7);

      const returnedIds = data.orders.map((o) => o.orderId);
      assert(returnedIds.includes('TEST-ORD-TODAY'), 'Must include today order');
      assert(returnedIds.includes('TEST-ORD-3DAYS'), 'Must include 3-days ago order');
      assert(!returnedIds.includes('TEST-ORD-10DAYS'), 'Must EXCLUDE order from 10 days ago (outside rolling 7-day window)');

      // Verify item fields: name, quantity in kg, historical unit price, line total, order total
      const todayOrder = data.orders.find((o) => o.orderId === 'TEST-ORD-TODAY');
      assert(todayOrder);
      assert.strictEqual(todayOrder.date, todayIso);
      assert.strictEqual(Number(todayOrder.total), 265.0);
      assert.strictEqual(todayOrder.items.length, 1);
      assert.strictEqual(todayOrder.items[0].name, 'Onio Medium');
      assert.strictEqual(Number(todayOrder.items[0].qty), 5);
      assert.strictEqual(todayOrder.items[0].unit, 'Kgs');
      assert.strictEqual(Number(todayOrder.items[0].unitPrice), 53.0);
      assert.strictEqual(Number(todayOrder.items[0].lineTotal), 265.0);
      assert.strictEqual(todayOrder.paymentStatus, 'Collected');
    });

    test('Access is denied for unassigned shop (agent permission guard)', async () => {
      // Shop 103 is not assigned to agentUser
      const res = await fetch('http://localhost:3001/api/shops/103/order-history?days=7', {
        headers: { Authorization: `Bearer ${agentToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    test('Returns clear empty state when shop has zero orders in 7-day period', async () => {
      // Shop 102 has no orders in last 7 days
      // Temporarily assign shop 102 to agentUser so they have permission
      await fetch('http://localhost:3001/api/shops/102/assign', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ agentId: agentUser.id })
      });

      const res = await fetch('http://localhost:3001/api/shops/102/order-history?days=7', {
        headers: { Authorization: `Bearer ${agentToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 200);
      assert.strictEqual(data.ordersCount, 0);
      assert.deepStrictEqual(data.orders, []);
    });
  });
});
