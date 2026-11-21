/**
 * Full-fidelity database backup and restore (format version 2).
 *
 * Backup: read-only. Dumps every application table row-for-row (all columns, no row limits).
 * Restore: validates the file, then replaces all application data inside ONE transaction, so a failure
 * leaves the database unchanged.
 *
 * Never included: sessions and login_attempts (security data). Restore clears both, so every user signs in again.
 */
import crypto from 'crypto';

export const BACKUP_FORMAT = 'linecart-backup';
export const BACKUP_VERSION = 2;
export const EXCLUDED_TABLES = new Set(['sessions', 'login_attempts']);

// Parents before children (insert order). Deletion runs in reverse.
const TABLE_ORDER = [
  'schema_migrations',
  'users',
  'clusters',
  'survey_items',
  'items',
  'shops',
  'orders',
  'order_items',
  'price_requests',
  'cluster_item_prices',
  'price_history',
  'manager_assignments',
  'sales_targets',
  'role_permissions',
  'app_settings',
  'audit_logs'
];

const quoteIdent = (name) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier '${name}'`);
  return `"${name}"`;
};

const jsonSafe = (_key, value) => (typeof value === 'bigint' ? value.toString() : value);

export function checksumTables(tables) {
  return crypto.createHash('sha256').update(JSON.stringify(tables, jsonSafe)).digest('hex');
}

export async function listTables(db) {
  const res = db.mode === 'postgres'
    ? await db.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
    : await db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const names = res.rows.map((r) => String(r.name)).filter((n) => !EXCLUDED_TABLES.has(n));
  const known = TABLE_ORDER.filter((t) => names.includes(t));
  const others = names.filter((n) => !TABLE_ORDER.includes(n)).sort();
  return [...known, ...others];
}

export async function listColumns(db, table) {
  if (db.mode === 'postgres') {
    const res = await db.query(
      "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
      [table]
    );
    return res.rows.map((r) => String(r.name));
  }
  const res = await db.query(`PRAGMA table_info(${quoteIdent(table)})`);
  return res.rows.map((r) => String(r.name));
}

/** Read-only snapshot of every application table. */
export async function createBackupSnapshot(db) {
  const tables = {};
  for (const table of await listTables(db)) {
    const columns = await listColumns(db, table);
    const res = await db.query(`SELECT * FROM ${quoteIdent(table)}`);
    tables[table] = {
      columns,
      rows: res.rows.map((row) => columns.map((c) => (row[c] === undefined ? null : row[c])))
    };
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([t, v]) => [t, v.rows.length]));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    sourceEngine: db.mode,
    counts,
    checksum: checksumTables(tables),
    tables
  };
}

export function isLegacySnapshot(snapshot) {
  return Boolean(snapshot && snapshot.format !== BACKUP_FORMAT && snapshot.tables && Array.isArray(snapshot.tables.users));
}

/**
 * Check a snapshot against the target database. Returns { ok, errors, warnings }.
 */
export async function validateSnapshot(db, snapshot) {
  const errors = [];
  const warnings = [];
  if (!snapshot || snapshot.format !== BACKUP_FORMAT) errors.push('Not a LineCart full backup (format field missing or wrong).');
  else if (snapshot.version !== BACKUP_VERSION) errors.push(`Unsupported backup version ${snapshot.version}.`);
  if (errors.length) return { ok: false, errors, warnings };

  if (!snapshot.tables || typeof snapshot.tables !== 'object') {
    return { ok: false, errors: ['Backup has no tables.'], warnings };
  }
  if (checksumTables(snapshot.tables) !== snapshot.checksum) {
    errors.push('Checksum mismatch: the backup file is damaged or was edited.');
  }
  for (const required of ['users', 'shops', 'orders', 'order_items']) {
    if (!snapshot.tables[required]) errors.push(`Backup is missing required table '${required}'.`);
  }
  const targetTables = await listTables(db);
  for (const [table, data] of Object.entries(snapshot.tables)) {
    if (EXCLUDED_TABLES.has(table)) {
      errors.push(`Backup unexpectedly contains '${table}'.`);
      continue;
    }
    if (!targetTables.includes(table)) {
      errors.push(`Table '${table}' does not exist in the target database.`);
      continue;
    }
    if (!Array.isArray(data.columns) || !Array.isArray(data.rows)) {
      errors.push(`Table '${table}' is malformed.`);
      continue;
    }
    const targetCols = await listColumns(db, table);
    const unknown = data.columns.filter((c) => !targetCols.includes(c));
    if (unknown.length) errors.push(`Table '${table}' has columns the target lacks: ${unknown.join(', ')}.`);
    const missing = targetCols.filter((c) => !data.columns.includes(c));
    if (missing.length) warnings.push(`Table '${table}': ${missing.join(', ')} not in backup; defaults will be used.`);
    if (data.rows.some((r) => !Array.isArray(r) || r.length !== data.columns.length)) {
      errors.push(`Table '${table}' has rows that do not match its column list.`);
    }
    if (snapshot.counts && snapshot.counts[table] !== data.rows.length) {
      errors.push(`Table '${table}' row count does not match the recorded count.`);
    }
  }
  for (const t of targetTables) {
    if (!snapshot.tables[t]) warnings.push(`Target table '${t}' is not in the backup; it will be emptied.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Replace all application data with the snapshot, atomically. Also clears sessions and login attempts.
 * Returns per-table restored counts.
 */
export async function restoreSnapshot(db, snapshot) {
  const check = await validateSnapshot(db, snapshot);
  if (!check.ok) throw new Error(`Backup failed validation:\n - ${check.errors.join('\n - ')}`);

  const targetTables = await listTables(db);
  const insertOrder = targetTables; // listTables already returns parents before children
  const restored = {};

  await db.withTransaction(async (tx) => {
    await tx.query('DELETE FROM sessions');
    await tx.query('DELETE FROM login_attempts');
    for (const table of [...insertOrder].reverse()) {
      await tx.query(`DELETE FROM ${quoteIdent(table)}`);
    }
    for (const table of insertOrder) {
      const data = snapshot.tables[table];
      restored[table] = 0;
      if (!data || data.rows.length === 0) continue;
      const cols = data.columns.map(quoteIdent).join(', ');
      const placeholders = data.columns.map((_, i) => `$${i + 1}`).join(', ');
      const sql = `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${placeholders})`;
      for (const row of data.rows) {
        await tx.query(sql, row);
        restored[table] += 1;
      }
    }
  });
  return restored;
}

/** Row counts of every application table (read-only). */
export async function tableCounts(db) {
  const counts = {};
  for (const table of await listTables(db)) {
    const r = await db.query(`SELECT COUNT(*) AS cnt FROM ${quoteIdent(table)}`);
    counts[table] = Number(r.rows[0]?.cnt || 0);
  }
  return counts;
}
