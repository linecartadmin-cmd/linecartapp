/**
 * PR-8: full-fidelity, read-only backups and atomic, validated restores (server/migrate.js).
 * Every scenario uses its own temporary SQLite files.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linecart-backup-'));
const SRC = path.join(work, 'source.db');
const PHOTO = 'data:image/jpeg;base64,' + 'B'.repeat(5000);

function migrate(dbPath, args, extraEnv = {}) {
  return spawnSync(process.execPath, ['server/migrate.js', ...args], {
    cwd: repoRoot,
    env: { ...process.env, LINECART_TEST_MODE: '1', LOCAL_DB_PATH: dbPath, DATABASE_URL: '', NODE_ENV: 'test', APP_ENV: '', RENDER: '', ...extraEnv },
    encoding: 'utf8',
    timeout: 60000
  });
}

function q(dbPath, sql, ...params) {
  const d = new DatabaseSync(dbPath);
  try {
    return d.prepare(sql).all(...params);
  } finally {
    d.close();
  }
}
function exec(dbPath, sql) {
  const d = new DatabaseSync(dbPath);
  try {
    d.exec(sql);
  } finally {
    d.close();
  }
}
const count = (dbPath, table) => Number(q(dbPath, `SELECT COUNT(*) AS c FROM ${table}`)[0].c);

before(() => {
  const r = migrate(SRC, []);
  assert.strictEqual(r.status, 0, r.stderr);
  exec(SRC, `
    UPDATE shops SET assigned_agent_id = 2 WHERE shop_id = 101;
    INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name, cluster_id,
      order_date, created_at, status, items_count, total, delivery_agent_id, payment_status, payment_amount_collected,
      payment_balance_due, payment_collected_at, location_lat, location_lng, location_text, visit_photo, visit_photo_status,
      expected_delivery_date)
    VALUES ('S101-30001', 30001, 'S101', 101, 'Shop', 'Retail', 1, 'Agent', 1, '2026-11-01', '2026-11-01T05:00:00Z',
      'Delivered', 1, 500, 50, 'Partially collected', 200, 300, '2026-11-02T05:00:00Z', 10.5, 77.1, '10.5, 77.1',
      '${PHOTO}', 'synced', '2026-11-02');
    INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, requested_price, price_request_status, item_json)
    VALUES (9001, 'S101-30001', 1, 'Onio Medium', 10, 50, 50, 50, 45, 'pending', '{}');
    INSERT INTO price_requests (id, order_id, item_id, shop_id, cluster_id, agent_id, requested_price, catalog_price, reason, status, created_at)
    VALUES ('pr-30001-1', 'S101-30001', 1, 101, 1, 1, 45, 50, 'test', 'pending', '2026-11-01T05:00:00Z');
    INSERT INTO cluster_item_prices (id, cluster_id, item_id, price, effective_date, updated_at, updated_by, updated_by_name)
    VALUES ('cip-1-1', 1, 1, 51.5, '2026-11-01', '2026-11-01T05:00:00Z', 950, 'Admin');
    INSERT INTO sessions (token_hash, user_id, role, is_dev_admin, created_at, last_seen, expires_at) VALUES ('h1', 1, 'Field Sales Agent', 0, 1, 1, 9999999999999);
    INSERT INTO login_attempts (identifier, ip_address, attempted_at, success) VALUES ('9876543210', '1.2.3.4', 1, 0);
  `);
  const d = new DatabaseSync(SRC);
  const ins = d.prepare("INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details) VALUES (?, ?, 1, 'A', 'TEST', 'X', '1', 'd')");
  for (let i = 0; i < 650; i += 1) ins.run(`AUD-T-${i}`, `2026-11-01T00:00:${String(i % 60).padStart(2, '0')}Z`);
  d.close();
});

describe('Backup', () => {
  let backupFile;

  test('is complete: every table, every column, no row limits, no security tables', () => {
    backupFile = path.join(work, 'full.json');
    const r = migrate(SRC, ['--backup', backupFile]);
    assert.strictEqual(r.status, 0, r.stderr);
    const snap = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    assert.strictEqual(snap.format, 'linecart-backup');
    assert.strictEqual(snap.version, 2);
    assert.ok(!snap.tables.sessions && !snap.tables.login_attempts, 'sessions/login_attempts excluded');
    assert.strictEqual(snap.counts.audit_logs, count(SRC, 'audit_logs'));
    assert.ok(snap.counts.audit_logs > 600, 'no 500-row cap');
    const orders = snap.tables.orders;
    const row = orders.rows.find((r2) => r2[orders.columns.indexOf('order_id')] === 'S101-30001');
    const col = (name) => row[orders.columns.indexOf(name)];
    assert.strictEqual(col('visit_photo'), PHOTO);
    assert.strictEqual(col('payment_status'), 'Partially collected');
    assert.strictEqual(Number(col('payment_balance_due')), 300);
    assert.strictEqual(col('expected_delivery_date'), '2026-11-02');
    for (const t of ['price_requests', 'cluster_item_prices', 'items', 'price_history', 'schema_migrations']) {
      assert.ok(snap.tables[t], `${t} included`);
    }
  });

  test('is read-only: two consecutive backups are identical and the database is unchanged', () => {
    const before = q(SRC, 'SELECT COUNT(*) AS c FROM audit_logs')[0].c;
    const f2 = path.join(work, 'full2.json');
    assert.strictEqual(migrate(SRC, ['--backup', f2]).status, 0);
    const a = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    const b = JSON.parse(fs.readFileSync(f2, 'utf8'));
    assert.strictEqual(a.checksum, b.checksum);
    assert.strictEqual(q(SRC, 'SELECT COUNT(*) AS c FROM audit_logs')[0].c, before, 'no audit row written');
    assert.strictEqual(count(SRC, 'sessions'), 1, 'sessions untouched');
  });

  describe('Restore', () => {
    const TARGET = path.join(work, 'target.db');

    test('round-trips into a fresh database with identical data and clears sessions', () => {
      const r = migrate(TARGET, ['--restore', backupFile, '--force']);
      assert.strictEqual(r.status, 0, r.stderr + r.stdout);
      const snap = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
      for (const [table, n] of Object.entries(snap.counts)) assert.strictEqual(count(TARGET, table), n, table);
      const o = q(TARGET, "SELECT * FROM orders WHERE order_id = 'S101-30001'")[0];
      assert.strictEqual(o.visit_photo, PHOTO);
      assert.strictEqual(o.payment_status, 'Partially collected');
      assert.strictEqual(Number(o.payment_amount_collected), 200);
      assert.strictEqual(Number(q(TARGET, 'SELECT assigned_agent_id AS a FROM shops WHERE shop_id = 101')[0].a), 2);
      assert.strictEqual(count(TARGET, 'price_requests'), snap.counts.price_requests);
      assert.strictEqual(count(TARGET, 'sessions'), 0);
      assert.strictEqual(count(TARGET, 'login_attempts'), 0);
      const verify = migrate(TARGET, ['--verify', backupFile]);
      assert.match(verify.stdout, /All table counts match/);
    });

    test('a damaged file is refused and nothing changes', () => {
      const snap = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
      snap.tables.orders.rows[0][snap.tables.orders.columns.indexOf('total')] = 1;
      const bad = path.join(work, 'tampered.json');
      fs.writeFileSync(bad, JSON.stringify(snap));
      const beforeHash = crypto.createHash('sha256').update(JSON.stringify(q(TARGET, 'SELECT order_id, total FROM orders ORDER BY order_id'))).digest('hex');
      const r = migrate(TARGET, ['--restore', bad, '--force']);
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr, /Checksum mismatch/);
      const afterHash = crypto.createHash('sha256').update(JSON.stringify(q(TARGET, 'SELECT order_id, total FROM orders ORDER BY order_id'))).digest('hex');
      assert.strictEqual(afterHash, beforeHash);
    });

    test('a failure halfway through rolls everything back', async () => {
      const { checksumTables } = await import('../server/backup.js');
      const snap = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
      // Duplicate an order_items primary key: inserts fail after users/shops/orders were already written
      const oi = snap.tables.order_items;
      oi.rows.push([...oi.rows[0]]);
      snap.counts.order_items = oi.rows.length;
      snap.checksum = checksumTables(snap.tables);
      const bad = path.join(work, 'dup.json');
      fs.writeFileSync(bad, JSON.stringify(snap));
      exec(TARGET, "INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details) VALUES ('MARKER', 'x', 1, 'A', 'MARKER', 'X', '1', 'd')");
      const r = migrate(TARGET, ['--restore', bad, '--force']);
      assert.notStrictEqual(r.status, 0);
      assert.strictEqual(count(TARGET, "audit_logs WHERE id = 'MARKER'"), 1, 'pre-existing data survived the failed restore');
      assert.ok(count(TARGET, 'orders') > 0);
    });

    test('old-format backups need --accept-lossy', () => {
      const legacy = path.join(work, 'legacy.json');
      fs.writeFileSync(legacy, JSON.stringify({ createdAt: 'x', mode: 'x', tables: { users: [], shops: [], orders: [] } }));
      const r = migrate(TARGET, ['--restore', legacy, '--force']);
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr, /old-format backup/);
      assert.ok(count(TARGET, 'orders') > 0, 'nothing deleted');
    });

    test('production and staging require --allow-production-restore', () => {
      for (const env of [{ NODE_ENV: 'production' }, { APP_ENV: 'staging' }]) {
        const r = migrate(TARGET, ['--restore', backupFile, '--force'], env);
        assert.notStrictEqual(r.status, 0, JSON.stringify(env));
        assert.match(r.stderr, /RESTORE BLOCKED/);
      }
    });
  });
});
