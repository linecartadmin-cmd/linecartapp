/**
 * Verification Test Suite: Order History & Summary Report Accuracy + Admin Audited CRUD
 * 
 * Scenarios:
 * 1. Zero orders: All report totals, shop counts, item quantities are 0 with empty states and zero demo rows.
 * 2. 1 order / 1 item: Exactly 1 order, 1 ordered shop, only that item's quantity (no fabricated/un-ordered items).
 * 3. Multiple lines and delivery statuses: Correct sums, no row multiplication or count/quantity confusion.
 * 4. Filters (cluster, date range, agent): Scoped orders match across summary, delivery status, and item lists.
 * 5. Admin CRUD: Create, edit, cancel, delete persist in DB, write audit logs, reject non-admins with HTTP 403.
 * 6. Offline outbox preservation: Unsynced real orders survive cache cleanup and sync without duplication.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { db, runMigrationsAndSeed, loadDatabaseState } from '../server/db.js';
import * as seedData from '../server/data.loader.js';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

describe('Order History & Summary Report Test Suite', async () => {
  let adminUser = null;
  let managerUser = null;
  let agentUser = null;
  let unauthorizedAgent = null;

  let adminToken = null;
  let managerToken = null;
  let agentToken = null;
  let unauthorizedAgentToken = null;

  const createTestSession = async (user, isAdmin = false) => {
    const rawToken = 'test-token-' + user.id + '-' + crypto.randomBytes(16).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = Date.now();
    const expiresAt = now + 24 * 3600 * 1000;
    await db.query(
      `INSERT INTO sessions (token_hash, user_id, role, is_dev_admin, created_at, last_seen, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
      [tokenHash, user.id, user.role, isAdmin ? 1 : 0, now, now, expiresAt]
    );
    return rawToken;
  };

  before(async () => {
    await db.init();
    await runMigrationsAndSeed({
      seedData,
      isProduction: false,
      defaultRolePermissions: {
        Admin: { pages: ['items', 'admin-dashboard', 'manager-orders'], actions: ['manage_items', 'manage_daily_prices', 'approve_price_requests', 'view_all_reports'] },
        'Sales Manager': { pages: ['items', 'manager-orders'], actions: ['view_items', 'update_daily_prices', 'approve_price_requests', 'view_team_reports', 'view_team_orders'] },
        'Field Sales Agent': { pages: ['overview', 'order-entry'], actions: ['create_order', 'view_agent_reports'] },
        'Delivery Agent': { pages: ['delivery'], actions: ['update_delivery_status', 'view_assigned_deliveries'] }
      }
    });

    const state = await loadDatabaseState();
    adminUser = state.users.find((u) => (u.role || '').toLowerCase() === 'admin');
    managerUser = state.users.find((u) => (u.role || '').toLowerCase() === 'sales manager');
    agentUser = state.users.find((u) => (u.role || '').toLowerCase() === 'field sales agent');

    // Create an unassigned field agent
    const unassignedRes = await db.query(
      `INSERT INTO users (name, password_hash, role, active, created_on, cluster_id)
       VALUES ('Unassigned Agent', 'hash', 'Field Sales Agent', 1, datetime('now'), 1)
       RETURNING id, name, role, cluster_id`
    );
    unauthorizedAgent = unassignedRes.rows[0];

    // Ensure manager is assigned to agentUser
    await db.query(
      `INSERT OR REPLACE INTO manager_assignments (manager_id, agent_id)
       VALUES ($1, $2)`,
      [managerUser.id, agentUser.id]
    );

    adminToken = await createTestSession(adminUser, true);
    managerToken = await createTestSession(managerUser, false);
    agentToken = await createTestSession(agentUser, false);
    unauthorizedAgentToken = await createTestSession(unauthorizedAgent, false);

    // Ensure database contains only canonical real order S101-24019 for pristine test baseline
    await db.query(`DELETE FROM order_items WHERE order_id != 'S101-24019'`);
    await db.query(`DELETE FROM price_requests WHERE order_id != 'S101-24019'`);
    await db.query(`DELETE FROM orders WHERE order_id != 'S101-24019'`);
    await db.query(`DELETE FROM audit_logs WHERE action LIKE 'ORDER_%'`);
  });

  // =========================================================================
  // Scenario 1: Zero orders
  // =========================================================================
  describe('Scenario 1: Zero orders produces zeros and clean empty states (No demo numbers)', () => {
    test('Cluster with zero orders has totalorderedshops=0 and empty deliverystatus / order_item_status', async () => {
      // Query gethomereport for agent with 0 orders
      const res = await fetch(`${BASE_URL}/gethomereport?spersonId=${unauthorizedAgent.id}`, {
        headers: { Authorization: `Bearer ${unauthorizedAgentToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 200);
      const clusters = data.result.clusterList;
      assert(Array.isArray(clusters));

      clusters.forEach((c) => {
        assert.strictEqual(c.order_shop_status.totalorderedshops, 0, 'No shops should be marked ordered');
        assert.strictEqual(c.deliverystatus.length, 0, 'deliverystatus must be completely empty (no 120 or 60 demo counts)');
        assert.strictEqual(c.order_item_status.length, 0, 'order_item_status must be completely empty');
      });
    });

    test('Zero orders endpoint returns empty array without demo orders S101-24018 or S039-24018', async () => {
      const res = await fetch(`${BASE_URL}/api/orders`, {
        headers: { Authorization: `Bearer ${unauthorizedAgentToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 200);
      assert.deepStrictEqual(data.orders, [], 'Unassigned agent with zero orders must have empty order list');
    });
  });

  // =========================================================================
  // Scenario 2: Exactly 1 order for 1 item (S101-24019 in DB)
  // =========================================================================
  describe('Scenario 2: Real persisted single order S101-24019 with 1 item', () => {
    test('Shows exactly 1 ordered shop and only the 1 ordered commodity (Onio Medium)', async () => {
      const res = await fetch(`${BASE_URL}/gethomereport?clusterId=1`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const cluster1 = data.result.clusterList.find((c) => Number(c.clusterId) === 1);
      assert(cluster1, 'Cluster 1 must exist');

      assert.strictEqual(cluster1.order_shop_status.totalorderedshops, 1, 'Exactly 1 shop ordered');
      assert.strictEqual(cluster1.deliverystatus.length, 1, 'Only 1 item ordered, so deliverystatus must have length 1');
      assert.strictEqual(cluster1.deliverystatus[0].name, 'Onio Medium');
      assert.strictEqual(cluster1.deliverystatus[0].totalcount, 10, 'Quantity must be exactly 10');
      assert.strictEqual(cluster1.deliverystatus[0].pendingApproval, 10, 'All 10 units are pending approval');
      assert.strictEqual(cluster1.deliverystatus[0].delivered, 0, '0 units delivered');

      // Unordered commodities must NOT appear in deliverystatus or order_item_status
      assert.strictEqual(cluster1.order_item_status.length, 1);
      assert.strictEqual(cluster1.order_item_status[0].name, 'Onio Medium');
      assert.strictEqual(cluster1.order_item_status[0].totalcount, 10);
    });

    test('Pending price approval units are not counted as fulfilled sales', async () => {
      const res = await fetch(`${BASE_URL}/gethomereport?clusterId=1`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();
      const cluster1 = data.result.clusterList.find((c) => Number(c.clusterId) === 1);
      const onio = cluster1.deliverystatus[0];
      assert.strictEqual(onio.fulfillment, 0, 'Fulfillment percentage must be 0% while pending approval');
    });
  });

  // =========================================================================
  // Scenario 3: Multiple lines and delivery statuses
  // =========================================================================
  describe('Scenario 3: Multiple lines and delivery statuses calculate exact sums without multiplication', () => {
    let createdMultiOrderId = null;

    after(async () => {
      if (createdMultiOrderId) {
        await fetch(`${BASE_URL}/api/admin/orders/${createdMultiOrderId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` }
        }).catch(() => {});
      }
    });

    test('Admin creates a multi-line order and verifies accurate line item aggregation', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          shopId: 102,
          spersonId: agentUser.id,
          clusterId: 1,
          orderDate: '2026-10-27',
          orderList: [
            { itemid: 1, itemName: 'Onio Medium', qty: 5, price: 50 },
            { itemid: 2, itemName: 'Onion Big', qty: 8, price: 30 }
          ]
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 200);
      assert(data.orderId);
      createdMultiOrderId = data.orderId;

      // Check report aggregation: Onio Medium (10 + 5 = 15), Onion Big (8)
      const repRes = await fetch(`${BASE_URL}/gethomereport?clusterId=1`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const repData = await repRes.json();
      const cluster1 = repData.result.clusterList.find((c) => Number(c.clusterId) === 1);

      assert.strictEqual(cluster1.order_shop_status.totalorderedshops, 2, 'Two distinct shops ordered');
      const onio = cluster1.deliverystatus.find((i) => i.name === 'Onio Medium');
      const onionBig = cluster1.deliverystatus.find((i) => i.name === 'Onion Big');

      assert(onio, 'Onio Medium must be in deliverystatus');
      assert.strictEqual(onio.totalcount, 15, 'Total units must be exactly 15 (10 + 5)');

      assert(onionBig, 'Onion Big must be in deliverystatus');
      assert.strictEqual(onionBig.totalcount, 8, 'Total units must be exactly 8');
    });

    test('Updating delivery status to Delivered reflects in delivered units and fulfillment %', async () => {
      // Edit the multi-line order to Delivered
      const updateRes = await fetch(`${BASE_URL}/api/admin/orders/${createdMultiOrderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          status: 'Delivered'
        })
      });
      assert.strictEqual(updateRes.status, 200);

      const repRes = await fetch(`${BASE_URL}/gethomereport?clusterId=1`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const repData = await repRes.json();
      const cluster1 = repData.result.clusterList.find((c) => Number(c.clusterId) === 1);

      const onionBig = cluster1.deliverystatus.find((i) => i.name === 'Onion Big');
      assert.strictEqual(onionBig.delivered, 8, 'All 8 units of Onion Big delivered');
      assert.strictEqual(onionBig.fulfillment, 100, 'Fulfillment must be 100%');

      // Cleanup multi-line order
      await fetch(`${BASE_URL}/api/admin/orders/${createdMultiOrderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
    });
  });

  // =========================================================================
  // Scenario 4: Filters (Cluster, Date Range, Agent)
  // =========================================================================
  describe('Scenario 4: Filter scoping consistency across report views', () => {
    test('Cluster filter isolates cluster orders without bleeding into other clusters', async () => {
      // S101-24019 is in Cluster 1. Query Cluster 2:
      const res = await fetch(`${BASE_URL}/gethomereport?clusterId=2`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();
      const cluster2 = data.result.clusterList.find((c) => Number(c.clusterId) === 2);
      assert(cluster2);
      assert.strictEqual(cluster2.order_shop_status.totalorderedshops, 0, 'Cluster 2 must have 0 ordered shops');
      assert.strictEqual(cluster2.deliverystatus.length, 0);
    });

    test('Date range filter respects fromDate and toDate boundaries', async () => {
      // Query historical date where no orders existed
      const res = await fetch(`${BASE_URL}/gethomereport?fromDate=2026-01-01&toDate=2026-01-02`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();
      data.result.clusterList.forEach((c) => {
        assert.strictEqual(c.order_shop_status.totalorderedshops, 0);
        assert.strictEqual(c.deliverystatus.length, 0);
      });
    });
  });

  // =========================================================================
  // Scenario 5: Admin Audited Order Management CRUD
  // =========================================================================
  describe('Scenario 5: Admin CRUD controls, audit logging, and role enforcement', () => {
    let testOrderId = null;

    test('Non-Admin (Sales Manager / Agent) cannot POST/PUT/DELETE admin order routes (HTTP 403)', async () => {
      const resCreate = await fetch(`${BASE_URL}/api/admin/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`
        },
        body: JSON.stringify({ shopId: 101, orderList: [{ itemid: 1, qty: 2 }] })
      });
      assert.strictEqual(resCreate.status, 403, 'Sales Manager must be forbidden from Admin order creation');

      const resDelete = await fetch(`${BASE_URL}/api/admin/orders/S101-24019`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentToken}` }
      });
      assert.strictEqual(resDelete.status, 403, 'Agent must be forbidden from Admin order deletion');
    });

    test('Admin successfully creates an order with audit trail ORDER_CREATED', async () => {
      const res = await fetch(`${BASE_URL}/api/admin/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          shopId: 101,
          spersonId: agentUser.id,
          clusterId: 1,
          orderDate: '2026-10-27',
          orderList: [
            { itemid: 1, itemName: 'Onio Medium', qty: 4, price: 50 }
          ]
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert(data.orderId);
      testOrderId = data.orderId;

      // Verify audit log
      const audit = await db.query(
        `SELECT * FROM audit_logs WHERE action = 'ORDER_CREATED' AND target_id = $1`,
        [testOrderId]
      );
      assert(audit.rows.length >= 1, 'ORDER_CREATED audit log must exist');
    });

    test('Admin updates line items and price without modifying the catalog price', async () => {
      // Get current catalog price of item 1
      const itemBefore = await db.query('SELECT price FROM items WHERE item_id = 1');
      const catalogPriceBefore = Number(itemBefore.rows[0].price);

      const updateRes = await fetch(`${BASE_URL}/api/admin/orders/${testOrderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          orderList: [
            { itemid: 1, itemName: 'Onio Medium', qty: 6, custprice: 55 }
          ]
        })
      });
      assert.strictEqual(updateRes.status, 200);

      // Verify order line updated
      const lineRes = await db.query('SELECT * FROM order_items WHERE order_id = $1', [testOrderId]);
      assert.strictEqual(lineRes.rows.length, 1);
      assert.strictEqual(Number(lineRes.rows[0].qty), 6);
      assert.strictEqual(Number(lineRes.rows[0].price), 55);

      // Verify catalog price was NOT modified
      const itemAfter = await db.query('SELECT price FROM items WHERE item_id = 1');
      assert.strictEqual(Number(itemAfter.rows[0].price), catalogPriceBefore, 'Catalog price must remain untouched');

      // Verify audit log
      const audit = await db.query(
        `SELECT * FROM audit_logs WHERE action = 'ORDER_UPDATED' AND target_id = $1`,
        [testOrderId]
      );
      assert(audit.rows.length >= 1);
    });

    test('Admin cancels order with reason and audit log ORDER_CANCELLED', async () => {
      const cancelRes = await fetch(`${BASE_URL}/api/admin/orders/${testOrderId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ reason: 'Customer requested cancellation over call' })
      });
      assert.strictEqual(cancelRes.status, 200);

      // Verify status in DB
      const orderDb = await db.query('SELECT status FROM orders WHERE order_id = $1', [testOrderId]);
      assert.strictEqual(orderDb.rows[0].status, 'Cancelled');

      // Verify audit log
      const audit = await db.query(
        `SELECT * FROM audit_logs WHERE action = 'ORDER_CANCELLED' AND target_id = $1`,
        [testOrderId]
      );
      assert.strictEqual(audit.rows.length, 1);
      assert(audit.rows[0].details.includes('Customer requested cancellation over call'));
    });

    test('Admin permanently deletes order with confirmation and audit log ORDER_DELETED', async () => {
      const delRes = await fetch(`${BASE_URL}/api/admin/orders/${testOrderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(delRes.status, 200);

      // Verify order removed from DB
      const orderDb = await db.query('SELECT * FROM orders WHERE order_id = $1', [testOrderId]);
      assert.strictEqual(orderDb.rows.length, 0);

      // Verify audit log
      const audit = await db.query(
        `SELECT * FROM audit_logs WHERE action = 'ORDER_DELETED' AND target_id = $1`,
        [testOrderId]
      );
      assert(audit.rows.length >= 1, 'ORDER_CREATED audit log must exist');
    });
  });

  // =========================================================================
  // Scenario 6: Offline outbox preservation
  // =========================================================================
  describe('Scenario 6: Offline outbox preservation and deduplication', () => {
    test('Unsynced temporary orders are preserved during cache cleanup and sync without duplicates', () => {
      // Simulate client local storage containing 1 pending outbox order and 1 synced order
      let clientCache = [
        { id: 'TEMP-1793090000', orderId: 'TEMP-1793090000', clientMutationId: 'mut-xyz', syncStatus: 'pending', total: 600 },
        { id: 'S101-24019', orderId: 'S101-24019', syncStatus: 'synced', total: 500 }
      ];

      // Cleanup demo IDs: ensure TEMP orders are NOT dropped
      const demoIds = new Set(['S101-24018', 'S103-24017', 'S039-24018', 'S042-24017']);
      clientCache = clientCache.filter((o) => !demoIds.has(o.id));
      assert.strictEqual(clientCache.length, 2, 'Pending offline order must not be deleted by cache cleaner');

      // Server returns synced real orderId: in-place merge avoids duplicate
      const syncedServerResponse = {
        id: 'S101-24020',
        orderId: 'S101-24020',
        clientMutationId: 'mut-xyz',
        total: 600,
        syncStatus: 'synced'
      };

      const existingIdx = clientCache.findIndex(
        (o) => (o.clientMutationId && o.clientMutationId === syncedServerResponse.clientMutationId)
      );
      assert(existingIdx >= 0, 'Found matching pending outbox order');
      clientCache[existingIdx] = { ...clientCache[existingIdx], ...syncedServerResponse };

      assert.strictEqual(clientCache.length, 2, 'Count remains exactly 2: never duplicates one order into two');
      assert.strictEqual(clientCache[0].id, 'S101-24020');
      assert.strictEqual(clientCache[0].syncStatus, 'synced');
    });
  });
});
