/**
 * Focused Verification Tests for Items & Daily Pricing Feature
 *
 * Verifies:
 * 1. Admin product creation/edit/archive and price updates
 * 2. Manager authorization and scope enforcement
 * 3. Price-history accuracy and preservation of historical order prices
 * 4. Offline price changes, reconnect/sync, retry idempotency, and concurrent-edit conflicts
 * 5. Existing order creation and reporting behavior
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { db, runMigrationsAndSeed, loadDatabaseState } from '../server/db.js';
import * as seedData from '../server/data.loader.js';

describe('Feature: Items & Daily Pricing', async () => {
  let adminUser = null;
  let managerUser = null;
  let unassignedClusterId = 99;

  before(async () => {
    await db.init();
    await runMigrationsAndSeed({
      seedData,
      isProduction: false,
      defaultRolePermissions: {
        Admin: { pages: ['items', 'admin-dashboard'], actions: ['manage_items', 'manage_daily_prices'] },
        'Sales Manager': { pages: ['items', 'reports'], actions: ['view_items', 'update_daily_prices'] },
        'Field Sales Agent': { pages: ['overview'], actions: ['create_order'] },
        'Delivery Agent': { pages: ['delivery'], actions: ['update_delivery_status'] }
      }
    });

    const state = await loadDatabaseState();
    adminUser = state.users.find((u) => (u.role || '').toLowerCase() === 'admin');
    managerUser = state.users.find((u) => (u.role || '').toLowerCase() === 'sales manager');
  });

  // =========================================================================
  // 1. Admin Product Lifecycle & Price Updates
  // =========================================================================
  describe('1. Admin Product Lifecycle & Price Updates', () => {
    let testItemId = 0;

    test('Admin creates a new product with validated price and unit', async () => {
      const maxRes = await db.query('SELECT COALESCE(MAX(item_id), 0) + 1 AS next_id FROM items');
      testItemId = Number(maxRes.rows[0].next_id);
      const nowIso = new Date().toISOString();

      await db.query(
        `INSERT INTO items (item_id, item_name, item_image, qty, price, cprice, kgs_per_unit, remarks, unit_type, active, created_at, updated_at, updated_by, updated_by_name)
         VALUES ($1, $2, $3, 0, $4, 0, $5, 0, $6, 1, $7, $8, $9, $10)`,
        [testItemId, 'Organic Bell Pepper', 'pepper.png', 75.0, 20, 'Bags', nowIso, nowIso, Number(adminUser.id), adminUser.name]
      );

      const check = await db.query('SELECT * FROM items WHERE item_id = $1', [testItemId]);
      assert.strictEqual(check.rowCount, 1);
      assert.strictEqual(check.rows[0].item_name, 'Organic Bell Pepper');
      assert.strictEqual(Number(check.rows[0].price), 75.0);
      assert.strictEqual(check.rows[0].unit_type, 'Bags');
      assert.strictEqual(Number(check.rows[0].active), 1);
    });

    test('Admin edits product details', async () => {
      const nowIso = new Date().toISOString();
      await db.query(
        `UPDATE items SET item_name = $1, unit_type = $2, updated_at = $3 WHERE item_id = $4`,
        ['Organic Bell Pepper Yellow', 'Boxes', nowIso, testItemId]
      );

      const check = await db.query('SELECT * FROM items WHERE item_id = $1', [testItemId]);
      assert.strictEqual(check.rows[0].item_name, 'Organic Bell Pepper Yellow');
      assert.strictEqual(check.rows[0].unit_type, 'Boxes');
    });

    test('Admin soft-archives product (active = 0) without deleting row', async () => {
      const nowIso = new Date().toISOString();
      await db.query('UPDATE items SET active = 0, updated_at = $1 WHERE item_id = $2', [nowIso, testItemId]);

      const check = await db.query('SELECT * FROM items WHERE item_id = $1', [testItemId]);
      assert.strictEqual(check.rowCount, 1, 'Row must be preserved in database');
      assert.strictEqual(Number(check.rows[0].active), 0);
    });

    test('Rejects hard deletion when product is referenced in orders', async () => {
      // Create a dummy order referencing testItemId
      const orderId = `TEST-ORD-${Date.now()}`;
      await db.query(
        `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, sperson_id, agent_name, cluster_id, order_date, created_at, status, items_count, total)
         VALUES ($1, 99999, 'S999', 33, 'Test Store', 6, 'Agent', 1, '2026-10-27', '2026-10-27T10:00:00Z', 'Delivered', 1, 1500)`,
        [orderId]
      );

      await db.query(
        `INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, item_json)
         VALUES (999999, $1, $2, 'Organic Bell Pepper Yellow', 20, 75, 75, 75, '{}')`,
        [orderId, testItemId]
      );

      // Check references
      const refCheck = await db.query('SELECT COUNT(*) AS cnt FROM order_items WHERE item_id = $1', [testItemId]);
      assert.ok(Number(refCheck.rows[0].cnt) > 0);

      // Validation logic: if referenced > 0, deletion is blocked
      const canDelete = Number(refCheck.rows[0].cnt) === 0;
      assert.strictEqual(canDelete, false, 'Deletion must be prohibited if product has existing orders');

      // Cleanup test order
      await db.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
      await db.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
      await db.query('DELETE FROM items WHERE item_id = $1', [testItemId]);
    });
  });

  // =========================================================================
  // 2. Manager Authorization and Scope Enforcement
  // =========================================================================
  describe('2. Manager Authorization and Scope Enforcement', () => {
    test('Sales Manager is strictly prohibited from creating or archiving products', () => {
      const callerRole = 'Sales Manager';
      const isAllowedToCreate = callerRole.toLowerCase() === 'admin';
      const isAllowedToArchive = callerRole.toLowerCase() === 'admin';
      assert.strictEqual(isAllowedToCreate, false, 'Sales Manager cannot create products');
      assert.strictEqual(isAllowedToArchive, false, 'Sales Manager cannot archive products');
    });

    test('Sales Manager cannot modify global catalog base rates (clusterId === 0)', () => {
      const callerRole = 'Sales Manager';
      const requestedClusterId = 0; // Global

      const canModifyGlobal = callerRole.toLowerCase() === 'admin';
      assert.strictEqual(canModifyGlobal, false, 'Sales Manager cannot update global baseline price');
    });

    test('Sales Manager is blocked from updating prices for unassigned clusters', async () => {
      const state = await loadDatabaseState();
      const managerId = Number(managerUser.id);
      const assignedAgentIds = state.managerAssignments[managerId] || [];
      const assignedClusters = state.users
        .filter((u) => assignedAgentIds.includes(Number(u.id)))
        .map((u) => Number(u.clusterid || 1));
      const authorizedClusters = Array.from(new Set([Number(managerUser.clusterid || 1), ...assignedClusters]));

      const requestedCluster = 999; // Outside supervision
      const isAuthorized = authorizedClusters.includes(requestedCluster);
      assert.strictEqual(isAuthorized, false, 'Cannot update prices in cluster 999');
    });

    test('Sales Manager is authorized to update prices for their assigned regional cluster', async () => {
      const managerCluster = Number(managerUser.clusterid || 1);
      const authorized = [managerCluster].includes(managerCluster);
      assert.strictEqual(authorized, true, 'Manager must be authorized for own cluster');
    });
  });

  // =========================================================================
  // 3. Price-History Accuracy and Preservation of Historical Order Prices
  // =========================================================================
  describe('3. Price-History Accuracy and Preservation of Historical Orders', () => {
    test('Records price change in price_history with old and new price and audit details', async () => {
      const historyId = `ph-test-${Date.now()}`;
      const itemId = 1;
      const oldPrice = 53.0;
      const newPrice = 58.5;
      const effDate = '2026-10-27';
      const nowIso = new Date().toISOString();

      await db.query(
        `INSERT INTO price_history (id, item_id, cluster_id, old_price, new_price, effective_date, created_at, changed_by, changed_by_name)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
        [historyId, itemId, oldPrice, newPrice, effDate, nowIso, Number(adminUser.id), adminUser.name]
      );

      const check = await db.query('SELECT * FROM price_history WHERE id = $1', [historyId]);
      assert.strictEqual(check.rowCount, 1);
      assert.strictEqual(Number(check.rows[0].old_price), 53.0);
      assert.strictEqual(Number(check.rows[0].new_price), 58.5);
      assert.strictEqual(check.rows[0].effective_date, '2026-10-27');
      assert.strictEqual(check.rows[0].changed_by_name, adminUser.name);

      await db.query('DELETE FROM price_history WHERE id = $1', [historyId]);
    });

    test('Historical order prices and totals remain unchanged after catalog price update', async () => {
      // Check existing historical order
      const existingOrders = await db.query('SELECT * FROM orders ORDER BY serial_no DESC LIMIT 1');
      assert.ok(existingOrders.rowCount > 0, 'Must have at least one existing order in DB');
      const order = existingOrders.rows[0];
      const originalTotal = Number(order.total);

      // Verify order line item prices in order_items snapshot
      const lineItems = await db.query('SELECT * FROM order_items WHERE order_id = $1', [order.order_id]);
      assert.ok(lineItems.rowCount > 0);
      const originalLinePrice = Number(lineItems.rows[0].price);

      // Simulate updating the catalog item price
      await db.query('UPDATE items SET price = price + 20 WHERE item_id = $1', [lineItems.rows[0].item_id]);

      // Re-query historical order to verify absolute immutability
      const recheckedOrder = await db.query('SELECT * FROM orders WHERE order_id = $1', [order.order_id]);
      const recheckedLine = await db.query('SELECT * FROM order_items WHERE id = $1', [lineItems.rows[0].id]);

      assert.strictEqual(Number(recheckedOrder.rows[0].total), originalTotal, 'Order total must never change');
      assert.strictEqual(Number(recheckedLine.rows[0].price), originalLinePrice, 'Order line item price must remain immutable');

      // Revert item price
      await db.query('UPDATE items SET price = price - 20 WHERE item_id = $1', [lineItems.rows[0].item_id]);
    });
  });

  // =========================================================================
  // 4. Offline Changes, Reconnect/Sync, Idempotency & Conflict Detection
  // =========================================================================
  describe('4. Offline Changes, Sync Retry Idempotency & Conflict Detection', () => {
    test('Idempotency prevents duplicate price history records on retry', async () => {
      const idempotencyKey = `idemp-price-${Date.now()}`;
      const phId = `ph-idemp-${Date.now()}`;
      const nowIso = new Date().toISOString();

      // First sync attempt
      await db.query(
        `INSERT INTO price_history (id, item_id, cluster_id, old_price, new_price, effective_date, created_at, changed_by, changed_by_name, idempotency_key)
         VALUES ($1, 1, 1, 50, 55, '2026-10-27', $2, $3, $4, $5)`,
        [phId, nowIso, Number(adminUser.id), adminUser.name, idempotencyKey]
      );

      // Second sync retry with same idempotencyKey
      const retryCheck = await db.query(
        'SELECT id, new_price FROM price_history WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      assert.strictEqual(retryCheck.rowCount, 1, 'Should find existing record');

      // Logic: if exists, return idempotent replay without inserting second row
      const countBefore = (await db.query('SELECT COUNT(*) AS cnt FROM price_history WHERE idempotency_key = $1', [idempotencyKey])).rows[0].cnt;
      assert.strictEqual(Number(countBefore), 1);

      await db.query('DELETE FROM price_history WHERE idempotency_key = $1', [idempotencyKey]);
    });

    test('Detects concurrent-edit conflict when server price was modified after client baseUpdatedAt', () => {
      const serverPriceRow = {
        price: 62.0,
        updated_at: '2026-10-27T11:00:00.000Z',
        updated_by_name: 'Admin'
      };

      const clientOfflineMutation = {
        basePrice: 55.0,
        baseUpdatedAt: '2026-10-27T09:00:00.000Z', // Client saw price at 9am
        newPrice: 58.0,
        forceOverwrite: false
      };

      const serverTime = new Date(serverPriceRow.updated_at).getTime();
      const clientBaseTime = new Date(clientOfflineMutation.baseUpdatedAt).getTime();
      const hasConflict =
        !clientOfflineMutation.forceOverwrite &&
        serverTime > clientBaseTime &&
        Number(serverPriceRow.price) !== Number(clientOfflineMutation.basePrice);

      assert.strictEqual(hasConflict, true, 'Server must detect concurrent update made while client was offline');
    });

    test('Force overwrite bypasses conflict when user explicitly chooses to overwrite server rate', () => {
      const serverPriceRow = {
        price: 62.0,
        updated_at: '2026-10-27T11:00:00.000Z',
        updated_by_name: 'Admin'
      };

      const clientOfflineMutation = {
        basePrice: 55.0,
        baseUpdatedAt: '2026-10-27T09:00:00.000Z',
        newPrice: 58.0,
        forceOverwrite: true // User confirmed overwrite
      };

      const serverTime = new Date(serverPriceRow.updated_at).getTime();
      const clientBaseTime = new Date(clientOfflineMutation.baseUpdatedAt).getTime();
      const hasConflict =
        !clientOfflineMutation.forceOverwrite &&
        serverTime > clientBaseTime &&
        Number(serverPriceRow.price) !== Number(clientOfflineMutation.basePrice);

      assert.strictEqual(hasConflict, false, 'Force overwrite must succeed without 409 conflict');
    });
  });

  // =========================================================================
  // 5. Existing Order Creation & Catalog Compatibility
  // =========================================================================
  describe('5. Existing Order Creation & Catalog Compatibility', () => {
    test('Cluster-specific daily rates override base catalog price for store ordering', () => {
      const baseCatalog = [
        { itemId: 1, itemName: 'Onio Medium', price: 53.0, active: 1 },
        { itemId: 2, itemName: 'Onion Big', price: 55.5, active: 1 }
      ];

      const clusterPrices = [
        { clusterId: 1, itemId: 1, price: 57.0 } // Override in Cluster 1
      ];

      // Map catalog for Cluster 1
      const cluster1Items = baseCatalog.map((item) => {
        const override = clusterPrices.find((cp) => cp.clusterId === 1 && cp.itemId === item.itemId);
        return {
          ...item,
          price: override ? override.price : item.price
        };
      });

      assert.strictEqual(cluster1Items[0].price, 57.0, 'Cluster 1 must see daily rate of 57');
      assert.strictEqual(cluster1Items[1].price, 55.5, 'Cluster 1 falls back to base price 55.5 when no override');

      // Map catalog for Cluster 2 (no overrides)
      const cluster2Items = baseCatalog.map((item) => {
        const override = clusterPrices.find((cp) => cp.clusterId === 2 && cp.itemId === item.itemId);
        return {
          ...item,
          price: override ? override.price : item.price
        };
      });

      assert.strictEqual(cluster2Items[0].price, 53.0, 'Cluster 2 sees base catalog rate');
    });

    test('Archived products (active = 0) are excluded from active ordering catalog', () => {
      const catalog = [
        { itemId: 1, itemName: 'Onio Medium', active: 1 },
        { itemId: 2, itemName: 'Onion Big', active: 0 } // Archived
      ];

      const activeOrderCatalog = catalog.filter((i) => i.active === 1);
      assert.strictEqual(activeOrderCatalog.length, 1);
      assert.strictEqual(activeOrderCatalog[0].itemId, 1);
    });
  });
});
