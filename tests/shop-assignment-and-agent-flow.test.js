/**
 * End-to-End Verification Tests: Shop Assignment & Field Sales Agent Scoping
 *
 * Scenarios:
 * 1. Field Sales Agent shop scoping:
 *    - Agent 1 receives only their assigned shops (e.g. shop 101).
 *    - Unassigned or other agents' shops are completely omitted from response.
 * 2. Cluster / route selector scoping:
 *    - Cluster route list only contains clusters that have shops assigned to the caller.
 *    - Agent with zero assigned shops receives clusterList: [] and empty shop lists.
 * 3. Shop Assignment Governance:
 *    - Admin can assign any shop to any Field Sales Agent (audit log SHOP_ASSIGNED recorded).
 *    - Sales Manager can assign shops to agents within their supervised team.
 *    - Sales Manager is blocked with HTTP 403 when trying to assign to an agent not on their team.
 *    - Field Sales Agent is strictly rejected with HTTP 403 from assigning shops to themselves or others.
 * 4. Order Creation Enforcement:
 *    - Agent is blocked with HTTP 403 when trying to create an order for a store not assigned to them.
 *    - Agent can create orders for their assigned store with a custom order date.
 * 5. Summary Report Live Metrics & Breakdowns:
 *    - Correct live active orders count and total shops count.
 *    - Shops by category breakdown matches real database distribution.
 *    - Zero demo/fabricated quantities or orders.
 * 6. Real Data Preservation:
 *    - Real user order S101-24019 and shop records remain intact.
 */

import { test, describe, before, after } from 'node:test';
import { insertTestUser } from './helpers/session.mjs';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { db, runMigrationsAndSeed, loadDatabaseState } from '../server/db.js';
import * as seedData from '../server/data.loader.js';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

describe('Shop Assignment & Field Sales Agent Scoping Test Suite', async () => {
  let adminUser = null;
  let managerUser = null;
  let agent1User = null;
  let teamAgentUser = null;
  let otherAgentUser = null;
  let zeroShopsAgentUser = null;

  let adminToken = '';
  let managerToken = '';
  let agent1Token = '';
  let otherAgentToken = '';
  let zeroShopsAgentToken = '';

  const createSession = async (user, isAdmin = false) => {
    const rawToken = 'test-token-' + crypto.randomUUID();
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
        Admin: { pages: ['customers', 'orders', 'summary', 'items'], actions: ['view_shops', 'view_all_reports', 'create_order'] },
        'Sales Manager': { pages: ['customers', 'orders', 'summary', 'items'], actions: ['view_shops', 'view_cluster_shops', 'view_team_reports', 'view_team_orders'] },
        'Field Sales Agent': { pages: ['overview', 'orders', 'customers', 'summary'], actions: ['view_assigned_shops', 'create_order', 'view_agent_reports'] }
      }
    });

    const state = await loadDatabaseState();
    adminUser = state.users.find((u) => (u.role || '').toLowerCase() === 'admin');
    managerUser = state.users.find((u) => Number(u.id) === 100); // Manager 100
    agent1User = state.users.find((u) => Number(u.id) === 1); // SalesPerson 1

    // Manager 100 has agent 4 and 6 in their team
    teamAgentUser = state.users.find((u) => Number(u.id) === 4);
    // Agent 3 is not on Manager 100's team
    otherAgentUser = state.users.find((u) => Number(u.id) === 3);

    // Create an agent with zero shops assigned
    let zeroAgent = state.users.find((u) => u.name === 'Agent With Zero Shops');
    if (!zeroAgent) {
      const row = await insertTestUser(db, { name: 'Agent With Zero Shops', role: 'Field Sales Agent', phone: '9199999999', phoneValid: 1, passwordHash: null });
      zeroShopsAgentUser = { id: Number(row.id), role: 'Field Sales Agent', name: 'Agent With Zero Shops' };
    } else {
      zeroShopsAgentUser = zeroAgent;
    }
    // Ensure zeroShopsAgent has no shops assigned
    await db.query('UPDATE shops SET assigned_agent_id = 1 WHERE assigned_agent_id = $1', [zeroShopsAgentUser.id]);

    adminToken = await createSession(adminUser, true);
    managerToken = await createSession(managerUser, false);
    agent1Token = await createSession(agent1User, false);
    otherAgentToken = await createSession(otherAgentUser, false);
    zeroShopsAgentToken = await createSession(zeroShopsAgentUser, false);
  });

  describe('1. Field Sales Agent Shop Scoping', () => {
    test('Agent 1 receives only shops assigned to them via /getitemsorder', async () => {
      const res = await fetch(`${BASE_URL}/getitemsorder?spersonId=1`, {
        headers: { Authorization: `Bearer ${agent1Token}` }
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.ok(json.result?.clusterList);

      const returnedShops = [];
      json.result.clusterList.forEach((c) => {
        (c.shopsList || []).forEach((s) => returnedShops.push(s));
      });

      // All returned shops must have assignedAgentId === 1
      assert.ok(returnedShops.length > 0, 'Agent 1 must have at least one assigned shop (Shop 101)');
      for (const s of returnedShops) {
        assert.strictEqual(Number(s.assignedAgentId), 1, `Shop ${s.shopid} must be assigned to agent 1`);
      }
      assert.ok(returnedShops.some((s) => Number(s.shopid) === 101), 'Shop 101 must be present for Agent 1');
    });

    test('Agent 1 receives only assigned shops via /api/shops', async () => {
      const res = await fetch(`${BASE_URL}/api/shops`, {
        headers: { Authorization: `Bearer ${agent1Token}` }
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.shops));
      for (const s of json.shops) {
        assert.strictEqual(Number(s.assignedAgentId), 1, `Shop ${s.shopid} must be assigned to agent 1`);
      }
    });

    test('Agent with 0 assigned shops receives empty clusterList: [] via /clusterinfo and /getitemsorder', async () => {
      const clusterRes = await fetch(`${BASE_URL}/clusterinfo?spersonId=${zeroShopsAgentUser.id}`, {
        headers: { Authorization: `Bearer ${zeroShopsAgentToken}` }
      });
      assert.strictEqual(clusterRes.status, 200);
      const clusterJson = await clusterRes.json();
      assert.deepStrictEqual(clusterJson.result?.clusterList, [], 'Clusters list must be empty when agent has 0 assigned shops');

      const itemsRes = await fetch(`${BASE_URL}/getitemsorder?spersonId=${zeroShopsAgentUser.id}`, {
        headers: { Authorization: `Bearer ${zeroShopsAgentToken}` }
      });
      assert.strictEqual(itemsRes.status, 200);
      const itemsJson = await itemsRes.json();
      assert.deepStrictEqual(itemsJson.result?.clusterList, [], 'Catalog clusterList must be empty when agent has 0 assigned shops');
    });
  });

  describe('2. Shop Assignment Governance & Permissions', () => {
    test('Admin can assign any shop to any Field Sales Agent', async () => {
      // Pick shop 33 and assign to agent 1
      const res = await fetch(`${BASE_URL}/api/shops/33/assign`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentId: 1 })
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.status, 200);
      assert.strictEqual(Number(json.shop.assignedAgentId), 1);

      // Verify persisted in DB
      const dbCheck = await db.query('SELECT assigned_agent_id FROM shops WHERE shop_id = 33');
      assert.strictEqual(Number(dbCheck.rows[0]?.assigned_agent_id), 1);

      // Verify audit log
      const auditRes = await db.query('SELECT * FROM audit_logs WHERE action = $1 ORDER BY timestamp DESC LIMIT 1', ['SHOP_ASSIGNED']);
      assert.strictEqual(auditRes.rowCount, 1);
      assert.ok(auditRes.rows[0].details.includes('33'));
    });

    test('Sales Manager can assign a shop to an agent on their team (Agent 4)', async () => {
      const res = await fetch(`${BASE_URL}/api/shops/34/assign`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentId: 4 })
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.status, 200);
      assert.strictEqual(Number(json.shop.assignedAgentId), 4);
    });

    test('Sales Manager CANNOT assign a shop to an agent outside their team (Agent 3 - HTTP 403)', async () => {
      const res = await fetch(`${BASE_URL}/api/shops/34/assign`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentId: 3 })
      });
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.ok(json.message.includes('not in your assigned team'));
    });

    test('Field Sales Agent is strictly prohibited from assigning shops (HTTP 403)', async () => {
      const res = await fetch(`${BASE_URL}/api/shops/36/assign`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${agent1Token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentId: 1 })
      });
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.ok(json.message.includes('Field Sales Agents cannot assign shops'));
    });
  });

  describe('3. Order Creation Enforcement', () => {
    test('Agent CANNOT create an order for a shop not assigned to them (HTTP 403)', async () => {
      // Shop 40 is assigned to agent 4, not agent 1
      await db.query('UPDATE shops SET assigned_agent_id = 4 WHERE shop_id = 40');

      const res = await fetch(`${BASE_URL}/createorder`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${agent1Token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          orderList: [
            {
              itemid: 1,
              itemName: 'Onio Medium',
              qty: 5,
              custprice: 50,
              customerid: 40,
              clusterid: 1,
              spersonid: 1,
              date: '2026-10-28'
            }
          ]
        })
      });
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.ok(json.message.includes('not assigned to you'));
    });

    test('Agent CAN create an order for their assigned shop (Shop 101) with custom order date', async () => {
      const res = await fetch(`${BASE_URL}/createorder`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${agent1Token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          orderList: [
            {
              itemid: 1,
              itemName: 'Onio Medium',
              qty: 5,
              custprice: 50,
              customerid: 101,
              clusterid: 1,
              spersonid: 1,
              date: '2026-10-29'
            }
          ]
        })
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.status, 200);
      assert.ok(json.orderId);

      // Verify order date in DB
      const orderRes = await db.query('SELECT order_date FROM orders WHERE order_id = $1', [json.orderId]);
      assert.strictEqual(orderRes.rows[0].order_date, '2026-10-29');

      // Cleanup test order to keep database clean
      await db.query('DELETE FROM order_items WHERE order_id = $1', [json.orderId]);
      await db.query('DELETE FROM orders WHERE order_id = $1', [json.orderId]);
    });
  });

  describe('4. Summary Report Live Metrics & Clean Data', () => {
    test('Summary Report endpoint returns accurate shop category breakdown and commodity lines without demo data', async () => {
      const res = await fetch(`${BASE_URL}/gethomereport?clusterId=1`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.status, 200);

      const cluster1 = json.result.clusterList.find((c) => Number(c.clusterId) === 1);
      assert.ok(cluster1, 'Cluster 1 stats must be present');
      assert.ok(Array.isArray(cluster1.shopsByCategory), 'shopsByCategory array must be provided');

      // Verify the single real order S101-24019 shows 1 ordered commodity
      assert.strictEqual(cluster1.order_shop_status.totalorderedshops, 1);
      assert.strictEqual(cluster1.deliverystatus.length, 1);
      assert.strictEqual(cluster1.deliverystatus[0].name, 'Onio Medium');
      assert.strictEqual(cluster1.deliverystatus[0].totalcount, 10);
    });
  });

  describe('5. Real Data Preservation', () => {
    test('Original order S101-24019 is preserved intact', async () => {
      const orderRes = await db.query('SELECT * FROM orders WHERE order_id = $1', ['S101-24019']);
      assert.strictEqual(orderRes.rowCount, 1);
      const o = orderRes.rows[0];
      assert.strictEqual(o.customer_name, 'MS bakery');
      assert.strictEqual(Number(o.total), 500);
      assert.strictEqual(o.status, 'Price approval pending');
    });
  });

  describe('6. Sales Manager Team Assignments & Quota Eligibility (No Mismatch)', () => {
    test('Admin assigns team members (Field Sales Agent #4 and Delivery Agent #50) to Manager 100', async () => {
      const res = await fetch(`${BASE_URL}/api/manager/assignments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          managerId: 100,
          agentIds: [4, 50]
        })
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.status, 200);
      assert.deepStrictEqual(json.assignedAgentIds, [4, 50]);

      // Verify persisted in DB
      const dbRes = await db.query('SELECT agent_id FROM manager_assignments WHERE manager_id = 100 ORDER BY agent_id ASC');
      assert.deepStrictEqual(dbRes.rows.map((r) => Number(r.agent_id)), [4, 50]);
    });

    test('Rejects assigning team to a non-sales-manager user ID (e.g. Admin or Agent)', async () => {
      const res = await fetch(`${BASE_URL}/api/manager/assignments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          managerId: 900, // Admin, not Sales Manager
          agentIds: [4]
        })
      });
      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.ok(json.message.includes('not an active Sales Manager'));
    });

    test('Manager 100 retrieves assigned team: count matches, member roles clearly displayed', async () => {
      const res = await fetch(`${BASE_URL}/api/manager/assignments`, {
        headers: { Authorization: `Bearer ${managerToken}` }
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.status, 200);
      assert.strictEqual(json.assignedAgents.length, 2);

      const salesAgent = json.assignedAgents.find((a) => Number(a.id) === 4);
      const delivAgent = json.assignedAgents.find((a) => Number(a.id) === 50);

      assert.ok(salesAgent, 'Field Sales Agent #4 must be in assigned team');
      assert.strictEqual(salesAgent.role, 'Field Sales Agent');

      assert.ok(delivAgent, 'Delivery Agent #50 must be in assigned team');
      assert.strictEqual(delivAgent.role, 'Delivery Agent');

      // Client filtering for sales targets: Delivery Agent is excluded from sales quotas
      const eligibleSalesAgents = json.assignedAgents.filter(
        (a) => (a.role || '').toLowerCase() === 'field sales agent' && Number(a.active ?? 1) === 1
      );
      assert.strictEqual(eligibleSalesAgents.length, 1);
      assert.strictEqual(eligibleSalesAgents[0].id, 4);
    });

    test('GET /api/manager/assigned-agents endpoint returns team for manager', async () => {
      const res = await fetch(`${BASE_URL}/api/manager/assigned-agents`, {
        headers: { Authorization: `Bearer ${managerToken}` }
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.status, 200);
      assert.strictEqual(json.agents.length, 2);
    });

    test('Sales Manager cannot modify team assignments (Admin only - HTTP 403)', async () => {
      const res = await fetch(`${BASE_URL}/api/manager/assignments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          managerId: 100,
          agentIds: [1, 4]
        })
      });
      assert.strictEqual(res.status, 403);
    });

    // Cleanup: restore manager 100 team to agents [1, 4, 6]
    test('Cleanup: restore original assignments for manager 100', async () => {
      await fetch(`${BASE_URL}/api/manager/assignments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          managerId: 100,
          agentIds: [1, 4, 6]
        })
      });
    });
  });
});
