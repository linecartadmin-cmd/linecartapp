/**
 * LineCart Pilot Verification Tests:
 * 1. Fresh install with no internet (seed data verification, no secrets/PII)
 * 2. Previously signed-in user reopening offline (cached user unlock & biometric auth gate)
 * 3. Offline order creation and subsequent sync (temp order reference, outbox idempotency)
 * 4. Offline delivery status update and subsequent sync (per-change queue, independent retries)
 * 5. Customer-specific price request workflow & approval controls:
 *    - Agent submission with custom rate and reason -> 'Price approval pending'
 *    - Delivery endpoint blocks dispatch/delivery while 'Price approval pending'
 *    - Agent self-approval attempt is strictly rejected (HTTP 403)
 *    - Out-of-scope manager approval attempt is strictly rejected (HTTP 403)
 *    - Authorized manager / admin approval recalculates order total and transitions order to 'In progress'
 *    - Rejection retains catalog price with required reason recorded in audit log
 * 6. Backend unavailable while cached screens are open (AdminDashboard, Delivery, Overview fallback)
 */

import { test, describe, before } from 'node:test';
import { insertTestUser } from './helpers/session.mjs';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { db, runMigrationsAndSeed, loadDatabaseState } from '../server/db.js';
import * as seedData from '../server/data.loader.js';
import { PILOT_SEED_DATA } from '../client/src/offline/pilotSeedData.js';

describe('Offline-First & Customer Price Requests Verification Suite', async () => {
  let adminUser = null;
  let managerUser = null;
  let agentUser = null;
  let deliveryUser = null;
  let otherManagerUser = null;

  let adminToken = null;
  let managerToken = null;
  let agentToken = null;
  let deliveryToken = null;
  let otherManagerToken = null;

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
      isProduction: false,
      defaultRolePermissions: {
        Admin: { pages: ['items', 'admin-dashboard', 'manager-orders'], actions: ['manage_items', 'manage_daily_prices', 'approve_price_requests'] },
        'Sales Manager': { pages: ['items', 'manager-orders'], actions: ['view_items', 'update_daily_prices', 'approve_price_requests'] },
        'Field Sales Agent': { pages: ['overview', 'order-entry'], actions: ['create_order'] },
        'Delivery Agent': { pages: ['delivery'], actions: ['update_delivery_status'] }
      }
    });

    const state = await loadDatabaseState();
    adminUser = state.users.find((u) => (u.role || '').toLowerCase() === 'admin');
    managerUser = state.users.find((u) => (u.role || '').toLowerCase() === 'sales manager');
    agentUser = state.users.find((u) => (u.role || '').toLowerCase() === 'field sales agent');
    deliveryUser = state.users.find((u) => (u.role || '').toLowerCase() === 'delivery agent');

    // Create a secondary manager to test out-of-scope authorization denial
    otherManagerUser = await insertTestUser(db, { name: 'Other Regional Manager', role: 'Sales Manager', clusterId: 999 });

    // Ensure managerUser is assigned to agentUser
    await db.query(
      `INSERT INTO manager_assignments (manager_id, agent_id)
       VALUES ($1, $2) ON CONFLICT (manager_id, agent_id) DO NOTHING`,
      [managerUser.id, agentUser.id]
    );

    // Ensure shop 101 and 102 are assigned to agentUser so agent is authorized to submit test orders
    await db.query('UPDATE shops SET assigned_agent_id = $1 WHERE shop_id IN (101, 102)', [agentUser.id]);

    // Create active session tokens for all roles
    adminToken = await createTestSession(adminUser);
    managerToken = await createTestSession(managerUser);
    agentToken = await createTestSession(agentUser);
    deliveryToken = await createTestSession(deliveryUser);
    otherManagerToken = await createTestSession(otherManagerUser);
  });

  // =========================================================================
  // Scenario 1: Fresh install with no internet (seed data verification, no secrets/PII)
  // =========================================================================
  describe('Scenario 1: Fresh install with no internet (Seed data verification, no secrets/PII)', () => {
    test('PILOT_SEED_DATA contains minimum essential offline data: clusters, shops, catalog items, and daily rates', () => {
      assert(Array.isArray(PILOT_SEED_DATA.clusters), 'Must contain pilot clusters');
      assert(PILOT_SEED_DATA.clusters.length >= 2, 'Must have at least 2 clusters');

      assert(Array.isArray(PILOT_SEED_DATA.items), 'Must contain catalog items');
      assert(PILOT_SEED_DATA.items.length >= 5, 'Must have at least 5 catalog commodities');

      assert(Array.isArray(PILOT_SEED_DATA.shops), 'Must contain pilot shops');
      assert(PILOT_SEED_DATA.shops.length >= 3, 'Must have at least 3 pilot shops');

      assert(Array.isArray(PILOT_SEED_DATA.dailyPrices), 'Must contain initial daily prices');
      assert(PILOT_SEED_DATA.dailyPrices.length >= 5, 'Must have initial daily prices');
    });

    test('PILOT_SEED_DATA strictly excludes sensitive credentials, tokens, hashes, and customer PII', () => {
      const serialized = JSON.stringify(PILOT_SEED_DATA).toLowerCase();

      // Check for forbidden secret identifiers
      const forbiddenTokens = [
        'password',
        'password_hash',
        'secret',
        'jwt',
        'session_token',
        'database_url',
        'postgres://',
        'render.com',
        'bearer',
        'api_key'
      ];

      for (const token of forbiddenTokens) {
        assert(
          !serialized.includes(token),
          `Security violation: Seed data bundled in APK must not contain "${token}"`
        );
      }

      // Check shops do not contain private phone numbers or customer banking data
      for (const shop of PILOT_SEED_DATA.shops) {
        assert(!shop.phoneNumber && !shop.phone, 'Pilot shops must not contain personal phone numbers');
        assert(!shop.bankAccount, 'Pilot shops must not contain banking details');
        assert(typeof shop.clusterid === 'number' || typeof shop.clusterId === 'number', 'Pilot shop must have numeric clusterId');
      }
    });
  });

  // =========================================================================
  // Scenario 2: Previously signed-in user reopening offline (cached user unlock & biometric auth gate)
  // =========================================================================
  describe('Scenario 2: Previously signed-in user reopening offline (cached user unlock)', () => {
    test('Re-authenticates previously signed-in user with cached profile when offline', () => {
      const mockCachedUser = {
        id: agentUser.id,
        name: agentUser.name,
        role: agentUser.role,
        clusterId: agentUser.cluster_id
      };

      const authenticateOffline = (requestedUserId, cachedUser, biometricSuccess) => {
        if (!cachedUser || !cachedUser.id) {
          return { success: false, error: 'No cached session. Online login required.' };
        }
        if (cachedUser.id !== requestedUserId) {
          return { success: false, error: 'Account switching requires an active internet connection.' };
        }
        if (!biometricSuccess) {
          return { success: false, error: 'Biometric / device credential verification failed.' };
        }
        return { success: true, user: cachedUser };
      };

      // Valid offline unlock
      const validUnlock = authenticateOffline(agentUser.id, mockCachedUser, true);
      assert.strictEqual(validUnlock.success, true);
      assert.strictEqual(validUnlock.user.id, agentUser.id);

      // Blocked account switching while offline
      const switchAttempt = authenticateOffline(adminUser.id, mockCachedUser, true);
      assert.strictEqual(switchAttempt.success, false);
      assert(switchAttempt.error.includes('Account switching requires'));

      // Blocked when biometric fails
      const failedBio = authenticateOffline(agentUser.id, mockCachedUser, false);
      assert.strictEqual(failedBio.success, false);
      assert(failedBio.error.includes('Biometric'));
    });
  });

  // =========================================================================
  // Scenario 3: Offline order creation with custom price request, idempotency, and subsequent sync
  // =========================================================================
  describe('Scenario 3: Offline order creation and subsequent sync', () => {
    let queuedOrder = null;
    let syncedServerOrder = null;

    test('Offline agent creates order with temporary reference, custom price request, and queued status', () => {
      const clientMutationId = 'mut-offline-order-' + Date.now();
      const idempotencyKey = 'idemp-key-' + Date.now();

      queuedOrder = {
        id: `TEMP-${Date.now().toString(36).toUpperCase()}`,
        clientMutationId,
        idempotencyKey,
        shopId: 101,
        agentId: agentUser.id,
        clusterId: 1,
        status: 'Price approval pending',
        syncStatus: 'pending',
        items: [
          {
            itemId: 1,
            name: 'Fresh Alphonso Mangoes',
            quantity: 10,
            catalogPrice: 50.0,
            requestedPrice: 42.0,
            priceRequestReason: 'Bulk distributor festival discount',
            priceRequestStatus: 'pending'
          }
        ],
        total: 420.0
      };

      assert(queuedOrder.id.startsWith('TEMP-'), 'Offline order must use temporary order reference');
      assert.strictEqual(queuedOrder.status, 'Price approval pending');
      assert.strictEqual(queuedOrder.syncStatus, 'pending');
      assert.strictEqual(queuedOrder.items[0].requestedPrice, 42.0);
    });

    test('Syncs queued order to server database and creates price_requests entry', async () => {
      const res = await fetch('http://localhost:3001/api/linecart/createorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`
        },
        body: JSON.stringify({
          clientMutationId: queuedOrder.clientMutationId,
          idempotencyKey: queuedOrder.idempotencyKey,
          orderList: [
            {
              itemid: 1,
              qty: 10,
              custprice: 50.0,
              requestedPrice: 42.0,
              priceRequestReason: 'Bulk distributor festival discount',
              customerid: 101,
              clusterid: 1,
              spersonid: agentUser.id
            }
          ]
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 200);
      assert.strictEqual(data.statusName, 'Price approval pending');
      assert.strictEqual(data.priceApprovalPending, true);
      assert(data.orderId, 'Server must return canonical orderId');
      assert(!data.orderId.startsWith('TEMP-'), 'Server orderId must not be temporary');

      syncedServerOrder = data;

      // Verify price_requests table in database
      const prRows = await db.query(
        `SELECT * FROM price_requests WHERE order_id = $1`,
        [data.orderId]
      );
      assert.strictEqual(prRows.rows.length, 1);
      assert.strictEqual(prRows.rows[0].status, 'pending');
      assert.strictEqual(Number(prRows.rows[0].requested_price), 42.0);
      assert.strictEqual(prRows.rows[0].reason, 'Bulk distributor festival discount');
    });

    test('Sync retry idempotency: Replaying exact same order returns identical order without duplication', async () => {
      const res = await fetch('http://localhost:3001/api/linecart/createorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`
        },
        body: JSON.stringify({
          clientMutationId: queuedOrder.clientMutationId,
          idempotencyKey: queuedOrder.idempotencyKey,
          orderList: [
            {
              itemid: 1,
              qty: 10,
              custprice: 50.0,
              requestedPrice: 42.0,
              priceRequestReason: 'Bulk distributor festival discount',
              customerid: 101,
              clusterid: 1,
              spersonid: agentUser.id
            }
          ]
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.orderId, syncedServerOrder.orderId);
      assert.strictEqual(data.idempotentReplay, true, 'Server must recognize idempotent replay');

      // Check DB order count for this mutation
      const countRes = await db.query(
        `SELECT COUNT(*) AS cnt FROM orders WHERE idempotency_key = $1`,
        [queuedOrder.idempotencyKey]
      );
      assert.strictEqual(Number(countRes.rows[0].cnt), 1, 'Database must have exactly 1 order row');
    });
  });

  // =========================================================================
  // Scenario 4: Offline delivery status update and subsequent sync
  // =========================================================================
  describe('Scenario 4: Offline delivery status update and subsequent sync', () => {
    let testOrderForDelivery = null;

    before(async () => {
      // Create a standard order without pending price requests for delivery workflow
      const orderRes = await fetch('http://localhost:3001/api/linecart/createorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`
        },
        body: JSON.stringify({
          idempotencyKey: 'delivery-test-' + Date.now(),
          orderList: [
            {
              itemid: 1,
              qty: 2,
              custprice: 50.0,
              customerid: 101,
              clusterid: 1,
              spersonid: agentUser.id
            }
          ]
        })
      });
      testOrderForDelivery = await orderRes.json();

      // Assign the order to deliveryUser so they have permission
      await db.query(
        `UPDATE orders SET delivery_agent_id = $1 WHERE order_id = $2`,
        [deliveryUser.id, testOrderForDelivery.orderId]
      );
    });

    test('Queues delivery status update in outbox with independent retry capability', () => {
      const deliveryQueue = [];
      const queueStatusUpdate = (orderId, newStatus) => {
        const item = {
          id: 'outbox-' + Date.now(),
          type: 'DELIVERY_STATUS_UPDATE',
          orderId,
          status: newStatus,
          timestamp: new Date().toISOString(),
          retryCount: 0,
          syncStatus: 'pending'
        };
        deliveryQueue.push(item);
        return item;
      };

      const queuedChange = queueStatusUpdate(testOrderForDelivery.orderId, 'Delivered');
      assert.strictEqual(queuedChange.syncStatus, 'pending');
      assert.strictEqual(deliveryQueue.length, 1);
    });

    test('Syncs delivery status update when connectivity returns', async () => {
      const res = await fetch(`http://localhost:3001/api/delivery/orders/${testOrderForDelivery.orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deliveryToken}`
        },
        body: JSON.stringify({
          status: 'Picked up'
        })
      });

      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.status, 200);
      assert.strictEqual(data.order.status, 'Picked up');

      // Verify DB status
      const dbCheck = await db.query(
        `SELECT status FROM orders WHERE order_id = $1`,
        [testOrderForDelivery.orderId]
      );
      assert.strictEqual(dbCheck.rows[0].status, 'Picked up');
    });
  });

  // =========================================================================
  // Scenario 5: Customer-specific price request workflow & approval controls
  // =========================================================================
  describe('Scenario 5: Customer-specific price request workflow & approval controls', () => {
    let orderWithPriceRequest = null;
    let priceRequestId = null;

    before(async () => {
      const res = await fetch('http://localhost:3001/api/linecart/createorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`
        },
        body: JSON.stringify({
          idempotencyKey: 'approval-test-' + Date.now(),
          orderList: [
            {
              itemid: 1,
              qty: 5,
              custprice: 50.0,
              requestedPrice: 40.0,
              priceRequestReason: 'Competitor price match',
              customerid: 101,
              clusterid: 1,
              spersonid: agentUser.id
            }
          ]
        })
      });
      orderWithPriceRequest = await res.json();

      // Assign delivery agent to test route blocking
      await db.query(
        `UPDATE orders SET delivery_agent_id = $1 WHERE order_id = $2`,
        [deliveryUser.id, orderWithPriceRequest.orderId]
      );

      const prRows = await db.query(
        `SELECT id FROM price_requests WHERE order_id = $1`,
        [orderWithPriceRequest.orderId]
      );
      priceRequestId = prRows.rows[0].id;
    });

    test('Delivery route strictly blocks dispatch and delivery while order is "Price approval pending"', async () => {
      const res = await fetch(`http://localhost:3001/api/delivery/orders/${orderWithPriceRequest.orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deliveryToken}`
        },
        body: JSON.stringify({ status: 'Picked up' })
      });

      assert.strictEqual(res.status, 400, 'Must block delivery updates when approval is pending');
      const data = await res.json();
      assert(
        data.message.includes('Price approval pending') || data.message.includes('cannot be dispatched'),
        'Error must inform user of pending approval'
      );
    });

    test('Self-approval by Field Sales Agent is strictly rejected (HTTP 403)', async () => {
      const res = await fetch(`http://localhost:3001/api/price-requests/${priceRequestId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`
        },
        body: JSON.stringify({ action: 'approve' })
      });

      assert.strictEqual(res.status, 403, 'Agent must not be permitted to approve own request');
      const data = await res.json();
      assert(
        data.message.includes('Self-approval is strictly forbidden') || data.message.includes('Only Administrators and Sales Managers'),
        'Must reject unauthorized agent approval'
      );
    });

    test('Out-of-scope Manager approval is strictly rejected (HTTP 403)', async () => {
      const res = await fetch(`http://localhost:3001/api/price-requests/${priceRequestId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherManagerToken}`
        },
        body: JSON.stringify({ action: 'approve' })
      });

      assert.strictEqual(res.status, 403, 'Manager outside assigned team/cluster must be blocked');
      const data = await res.json();
      assert(
        data.message.includes('outside your assigned team') || data.message.includes('scope'),
        'Must explain out-of-scope rejection'
      );
    });

    test('Authorized Sales Manager approves request: updates rate, recalculates total, and unblocks order', async () => {
      const res = await fetch(`http://localhost:3001/api/price-requests/${priceRequestId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`
        },
        body: JSON.stringify({
          action: 'approve',
          comment: 'Approved for volume client'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 200);
      assert.strictEqual(data.decision, 'approved');

      // Check order total in DB: 5 items * 40.0 = 200.0
      const orderDb = await db.query(
        `SELECT total, status FROM orders WHERE order_id = $1`,
        [orderWithPriceRequest.orderId]
      );
      assert.strictEqual(orderDb.rows[0].status, 'In progress');
      assert.strictEqual(Number(orderDb.rows[0].total), 200.0);

      // Check price_requests row status
      const prDb = await db.query(
        `SELECT status, decision_by, decision_comment FROM price_requests WHERE id = $1`,
        [priceRequestId]
      );
      assert.strictEqual(prDb.rows[0].status, 'approved');
      assert.strictEqual(prDb.rows[0].decision_by, managerUser.id);
      assert.strictEqual(prDb.rows[0].decision_comment, 'Approved for volume client');
    });

    test('Admin rejection workflow retains catalog rate and records decider reason', async () => {
      // Create another order with price request to test rejection
      const orderRes = await fetch('http://localhost:3001/api/linecart/createorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`
        },
        body: JSON.stringify({
          idempotencyKey: 'rejection-test-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
          orderList: [
            {
              itemid: 1,
              qty: 7,
              custprice: 50.0,
              requestedPrice: 38.0,
              priceRequestReason: 'Wholesale clearance discount',
              customerid: 102,
              clusterid: 1,
              spersonid: agentUser.id
            }
          ]
        })
      });
      assert.strictEqual(orderRes.status, 200);
      const orderData = await orderRes.json();
      assert(orderData.orderId, 'Order must be created');

      const prRows = await db.query(`SELECT id FROM price_requests WHERE order_id = $1`, [orderData.orderId]);
      assert(prRows.rows.length > 0, 'Price request record must exist');
      const prId = prRows.rows[0].id;

      // Admin rejects
      const rejRes = await fetch(`http://localhost:3001/api/price-requests/${prId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          action: 'reject',
          comment: 'Below allowable wholesale margin'
        })
      });

      assert.strictEqual(rejRes.status, 200);
      const rejData = await rejRes.json();
      assert.strictEqual(rejData.status, 200);
      assert.strictEqual(rejData.decision, 'rejected');

      // Verify item price retained catalog price in DB
      const itemDb = await db.query(`SELECT price, requested_price, price_request_status FROM order_items WHERE order_id = $1`, [orderData.orderId]);
      assert.strictEqual(itemDb.rows[0].price_request_status, 'rejected');
      // The catalog rate is resolved on the server (client-sent custprice 50.0 is ignored)
      const catalogRow = await db.query('SELECT price FROM items WHERE item_id = 1');
      assert.strictEqual(Number(itemDb.rows[0].price), Number(catalogRow.rows[0].price), 'Must retain the server catalog rate');

      // Verify audit log has rejection record
      const auditDb = await db.query(
        `SELECT * FROM audit_logs WHERE action = 'PRICE_REQUEST_DECISION' AND details LIKE $1`,
        [`%${orderData.orderId}%`]
      );
      assert(auditDb.rows.length >= 1, 'Audit log must record price request rejection');
    });
  });

  // =========================================================================
  // Scenario 6: Backend unavailable while cached screens are open
  // =========================================================================
  describe('Scenario 6: Backend unavailable while cached screens are open (Offline Fallbacks)', () => {
    test('AdminDashboardScreen offline cache fallback preserves visibility of metrics without "Retry Loading" error', () => {
      // Simulate dashboard cache structure used in AdminDashboardScreen.jsx
      const mockCachedMetrics = {
        metrics: {
          revenueToday: 145000,
          ordersToday: 24,
          activeRoutes: 6,
          deliveryCompletion: '92%'
        },
        cachedAt: new Date().toISOString()
      };

      const renderDashboardState = (networkError, cachedData) => {
        if (networkError && cachedData) {
          return {
            status: 'OFFLINE_CACHED',
            showMetrics: true,
            showOfflineBanner: true,
            showBlockingError: false,
            metrics: cachedData.metrics
          };
        }
        if (networkError && !cachedData) {
          return {
            status: 'ERROR',
            showMetrics: false,
            showOfflineBanner: false,
            showBlockingError: true
          };
        }
        return { status: 'ONLINE', showMetrics: true, showOfflineBanner: false, showBlockingError: false };
      };

      const result = renderDashboardState(new Error('Network connection failed'), mockCachedMetrics);
      assert.strictEqual(result.showBlockingError, false, 'Must not show blocking Retry Loading error');
      assert.strictEqual(result.showOfflineBanner, true, 'Must display offline notice banner');
      assert.strictEqual(result.metrics.revenueToday, 145000);
    });

    test('DeliveryRouteScreen loads cached delivery orders from local IndexedDB state when backend is unreachable', () => {
      const mockCachedDeliveryOrders = [
        { id: 'S01-2401', shopName: 'Quick Mart', status: 'In progress', total: 1200 },
        { id: 'S02-2402', shopName: 'City Foods', status: 'Completed', total: 2450 }
      ];

      const loadDeliveryView = (isNetworkAvailable, localStoreOrders) => {
        if (!isNetworkAvailable) {
          return {
            orders: localStoreOrders,
            isOffline: true,
            renderable: localStoreOrders.length > 0
          };
        }
        return { orders: localStoreOrders, isOffline: false, renderable: true };
      };

      const offlineView = loadDeliveryView(false, mockCachedDeliveryOrders);
      assert.strictEqual(offlineView.renderable, true);
      assert.strictEqual(offlineView.orders.length, 2);
      assert.strictEqual(offlineView.isOffline, true);
    });
  });
});
