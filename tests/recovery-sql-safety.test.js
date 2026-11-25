import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  generateGuardedRecoverySql,
  generateShopAuditVerificationSql,
  acquireExecutionLock,
  atomicWriteJson,
  computeMappingHash,
  APPROVED_MAPPING_SHA256,
  ASSIGNMENTS_BY_AGENT
} from '../scripts/prod-assign-shops.mjs';

function createIsolatedTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE shops (
      shop_id INTEGER PRIMARY KEY,
      shop_name TEXT NOT NULL,
      cluster_id INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL DEFAULT 6,
      assigned_agent_id INTEGER
    );

    CREATE TABLE orders (
      order_id TEXT PRIMARY KEY,
      shop_id INTEGER NOT NULL,
      sperson_id INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      total REAL NOT NULL
    );

    CREATE TABLE shop_visits (
      id INTEGER PRIMARY KEY,
      shop_id INTEGER NOT NULL,
      agent_id INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      admin_id INTEGER NOT NULL,
      admin_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT
    );
  `);
  return db;
}

test('Recovery SQL Safety, Concurrency & Isolation Tests', async (t) => {
  // 1. Concurrency Lock Tests
  await t.test('1. Concurrency lock: acquires and safely releases lock', () => {
    const lockFile = path.resolve('scripts/.prod-assign-shops.lock');
    try { fs.unlinkSync(lockFile); } catch {}

    const release = acquireExecutionLock('9870000001', '--execute');
    assert.ok(fs.existsSync(lockFile), 'Lock file must exist after acquisition');

    const content = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.equal(content.pid, process.pid);
    assert.equal(content.mode, '--execute');

    // Attempting to acquire again from same running process PID must be refused
    assert.throws(
      () => acquireExecutionLock('9870000002', '--execute'),
      /CONCURRENT EXECUTION REFUSED/,
      'Must refuse simultaneous execution'
    );

    // Release lock
    release();
    assert.ok(!fs.existsSync(lockFile), 'Lock file must be removed after release');
  });

  await t.test('2. Stale lock recovery: detects dead PID and reclaims lock safely', () => {
    const lockFile = path.resolve('scripts/.prod-assign-shops.lock');
    try { fs.unlinkSync(lockFile); } catch {}

    // Write a lock file with an impossible/dead PID (e.g. 99999999)
    const deadPid = 99999999;
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: deadPid,
      createdAt: new Date().toISOString(),
      adminPhone: '******0001',
      mode: '--execute'
    }));

    // Next acquisition should detect dead PID, clear stale lock, and acquire successfully
    const release = acquireExecutionLock('9870000001', '--execute');
    assert.ok(fs.existsSync(lockFile));
    const content = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.equal(content.pid, process.pid, 'Lock must be re-acquired by current process');

    release();
  });

  // 2. Partial Recovery Tests (1, 50, 100, 233 entries)
  const partialCounts = [1, 50, 100, 233];
  for (const count of partialCounts) {
    await t.test(`3.${count} Partial recovery with exact ${count} journaled assignments`, () => {
      const db = createIsolatedTestDb();
      const allPairs = [];
      for (const [aid, info] of Object.entries(ASSIGNMENTS_BY_AGENT)) {
        for (const sid of info.shops) {
          allPairs.push({ shopId: sid, targetAgentId: Number(aid) });
        }
      }

      const testSlice = allPairs.slice(0, count);
      // Seed shops in DB
      for (const item of testSlice) {
        db.exec(`INSERT INTO shops (shop_id, shop_name, assigned_agent_id) VALUES (${item.shopId}, 'Shop ${item.shopId}', ${item.targetAgentId})`);
      }
      // Also seed an untouched shop
      db.exec(`INSERT INTO shops (shop_id, shop_name, assigned_agent_id) VALUES (9999, 'Untouched Shop', NULL)`);

      const journal = {
        journalFileName: `test-journal-${count}.json`,
        assignedShops: testSlice
      };

      // Test standard SQL against SQLite
      const sql = generateGuardedRecoverySql(journal, { dialect: 'standard' });
      assert.ok(sql);
      db.exec(sql);

      // Verify all count shops are now NULL
      for (const item of testSlice) {
        const row = db.prepare('SELECT assigned_agent_id FROM shops WHERE shop_id = ?').get(item.shopId);
        assert.equal(row.assigned_agent_id, null, `Shop ${item.shopId} must be NULL`);
      }
      // Verify untouched shop remained NULL
      const untouched = db.prepare('SELECT assigned_agent_id FROM shops WHERE shop_id = 9999').get();
      assert.equal(untouched.assigned_agent_id, null);

      // Also verify PostgreSQL PL/pgSQL generated code contains exact expected count assertion
      const pgSql = generateGuardedRecoverySql(journal, { dialect: 'postgres' });
      assert.ok(pgSql.includes(`v_expected_rows CONSTANT integer := ${count};`), `Must declare expected rows = ${count}`);
      assert.ok(pgSql.includes('GET DIAGNOSTICS v_affected_rows = ROW_COUNT;'));
      assert.ok(pgSql.includes('RAISE EXCEPTION'));
    });
  }

  // 3. Deduplication in Recovery SQL
  await t.test('4. Duplicate journal entries: deduplicates by shopId and counts unique shops', () => {
    const journal = {
      journalFileName: 'test-journal-dups.json',
      assignedShops: [
        { shopId: 101, targetAgentId: 905 },
        { shopId: 101, targetAgentId: 905 }, // Duplicate
        { shopId: 102, targetAgentId: 906 },
        { shopId: 102, targetAgentId: 906 }  // Duplicate
      ]
    };

    const pgSql = generateGuardedRecoverySql(journal, { dialect: 'postgres' });
    assert.ok(pgSql.includes('v_expected_rows CONSTANT integer := 2;'), 'Expected count must be 2, not 4');
  });

  // 4. Guard Condition: Refuses to modify shops whose state differs from journal
  await t.test('5. Guard condition: skips shops modified to an unexpected agent', () => {
    const db = createIsolatedTestDb();
    db.exec(`
      INSERT INTO shops (shop_id, shop_name, assigned_agent_id) VALUES
      (101, 'Shop 101', 905),
      (102, 'Shop 102', 999); -- unexpected agent 999
    `);

    const journal = {
      journalFileName: 'test-unexpected.json',
      assignedShops: [
        { shopId: 101, targetAgentId: 905 },
        { shopId: 102, targetAgentId: 905 } // journal expected 905
      ]
    };

    const sql = generateGuardedRecoverySql(journal, { dialect: 'standard' });
    db.exec(sql);

    const r101 = db.prepare('SELECT assigned_agent_id FROM shops WHERE shop_id = 101').get();
    const r102 = db.prepare('SELECT assigned_agent_id FROM shops WHERE shop_id = 102').get();
    assert.equal(r101.assigned_agent_id, null, 'Matched shop must be reverted to NULL');
    assert.equal(r102.assigned_agent_id, 999, 'Mismatched shop must NOT be modified');
  });

  // 5. Historical Integrity Check
  await t.test('6. Historical integrity: zero mutation to orders, visits, or created_by', () => {
    const db = createIsolatedTestDb();
    db.exec(`
      INSERT INTO shops (shop_id, shop_name, created_by, assigned_agent_id) VALUES
      (101, 'Shop 101', 13, 905),
      (102, 'Shop 102', 9, 905);

      INSERT INTO orders (order_id, shop_id, sperson_id, agent_name, total) VALUES
      ('ORD-001', 101, 905, 'Sampath Kumar', 1500.0),
      ('ORD-002', 102, 905, 'Sampath Kumar', 2300.0);

      INSERT INTO shop_visits (id, shop_id, agent_id, latitude, longitude, created_at) VALUES
      (1, 101, 905, 11.0123, 76.9558, '2026-11-20T10:00:00Z');
    `);

    const preOrders = db.prepare('SELECT * FROM orders ORDER BY order_id').all();
    const preVisits = db.prepare('SELECT * FROM shop_visits ORDER BY id').all();
    const preShops = db.prepare('SELECT shop_id, created_by FROM shops ORDER BY shop_id').all();

    const journal = {
      journalFileName: 'test-integrity.json',
      assignedShops: [{ shopId: 101, targetAgentId: 905 }, { shopId: 102, targetAgentId: 905 }]
    };

    db.exec(generateGuardedRecoverySql(journal, { dialect: 'standard' }));

    const postOrders = db.prepare('SELECT * FROM orders ORDER BY order_id').all();
    const postVisits = db.prepare('SELECT * FROM shop_visits ORDER BY id').all();
    const postShops = db.prepare('SELECT shop_id, created_by, assigned_agent_id FROM shops ORDER BY shop_id').all();

    assert.deepEqual(preOrders, postOrders);
    assert.deepEqual(preVisits, postVisits);
    assert.equal(postShops[0].created_by, preShops[0].created_by);
    assert.equal(postShops[1].created_by, preShops[1].created_by);
    assert.equal(postShops[0].assigned_agent_id, null);
    assert.equal(postShops[1].assigned_agent_id, null);
  });

  // 6. Mapping Checksum Stability
  await t.test('7. Mapping checksum stability: exactly matches verified constant', () => {
    assert.equal(computeMappingHash(), APPROVED_MAPPING_SHA256);
  });

  // 7. Per-Shop Audit Verification: Duplicate records with different admin_name
  await t.test('8. Audit verification query: two matching records with different admin_name produce DUPLICATE, not two VERIFIED records', () => {
    const db = createIsolatedTestDb();
    const startTime = '2026-11-25T14:00:00.000Z';
    const logTime1 = '2026-11-25T14:01:00.000Z';
    const logTime2 = '2026-11-25T14:02:00.000Z';
    const endTime = '2026-11-25T14:05:00.000Z';
    const adminId = 1;

    // Seed two audit records for shop 101 with DIFFERENT admin_name values
    db.exec(`
      INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details) VALUES
      ('AUD-1', '${logTime1}', ${adminId}, 'Admin Alice', 'SHOP_ASSIGNED', 'Shop', '101', 'First assignment log'),
      ('AUD-2', '${logTime2}', ${adminId}, 'Admin Bob',   'SHOP_ASSIGNED', 'Shop', '101', 'Duplicate assignment log');
    `);

    const journal = {
      startedAt: startTime,
      completedAt: endTime,
      assignedShops: [{ shopId: 101, targetAgentId: 905 }]
    };

    const sql = generateShopAuditVerificationSql(journal, adminId, { dialect: 'standard' });
    const results = db.prepare(sql).all();

    // Must return exactly ONE row for shop 101, NOT two rows
    assert.equal(results.length, 1, 'Query must return exactly one row for shop 101');
    const row = results[0];
    assert.equal(row.expected_shop_id, 101);
    assert.equal(row.audit_count, 2, 'Audit count must be 2');
    assert.equal(row.verification_status, 'DUPLICATE', 'Verification status must be DUPLICATE, not VERIFIED');
    assert.ok(row.admin_names.includes('Admin Alice') && row.admin_names.includes('Admin Bob'), 'Aggregated admin names must contain both names');
  });

  // 7. Exact Previous Value Restoration Test
  await t.test('9. Exact previous state restoration: restores recorded previousAssignedId, never blindly NULL', () => {
    const db = createIsolatedTestDb();
    // Seed 3 shops assigned to new FSA agents after runner mutation
    db.exec(`
      INSERT INTO shops (shop_id, shop_name, assigned_agent_id) VALUES
      (40, 'Shop 40', 905),
      (74, 'Shop 74', 909),
      (103, 'Shop 103', 910);
    `);

    // Journal contains mixed previous values: 4 for Sampath shop, 13 for shared creator, NULL for fresh shop
    const journal = {
      journalFileName: 'test-exact-recovery.json',
      assignedShops: [
        { shopId: 40, targetAgentId: 905, previousAssignedId: 4 },
        { shopId: 74, targetAgentId: 909, previousAssignedId: 13 },
        { shopId: 103, targetAgentId: 910, previousAssignedId: null }
      ]
    };

    const sql = generateGuardedRecoverySql(journal, { dialect: 'standard' });
    db.exec(sql);

    const r40 = db.prepare('SELECT assigned_agent_id FROM shops WHERE shop_id = 40').get();
    const r74 = db.prepare('SELECT assigned_agent_id FROM shops WHERE shop_id = 74').get();
    const r103 = db.prepare('SELECT assigned_agent_id FROM shops WHERE shop_id = 103').get();

    assert.equal(r40.assigned_agent_id, 4, 'Shop 40 must be restored to exact previous integer 4');
    assert.equal(r74.assigned_agent_id, 13, 'Shop 74 must be restored to exact previous integer 13');
    assert.equal(r103.assigned_agent_id, null, 'Shop 103 must be restored to NULL');
  });
});
