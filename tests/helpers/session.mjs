/**
 * Shared helpers for tests that call the real test server.
 */
import crypto from 'node:crypto';
import { db } from '../../server/db.js';

export const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

let initialized = false;
export async function initTestDb() {
  if (!initialized) {
    await db.init();
    initialized = true;
  }
  return db;
}

/** Insert a session row for a user id and return the raw bearer token. */
export async function tokenFor(userId) {
  await initTestDb();
  const userRes = await db.query('SELECT id, role FROM users WHERE id = $1', [Number(userId)]);
  if (userRes.rowCount === 0) throw new Error(`Test user #${userId} not found`);
  const rawToken = 'test-token-' + crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const now = Date.now();
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, role, is_dev_admin, created_at, last_seen, expires_at, revoked_at)
     VALUES ($1, $2, $3, 0, $4, $5, $6, NULL)`,
    [tokenHash, Number(userId), userRes.rows[0].role, now, now, now + 3600 * 1000]
  );
  return rawToken;
}

export async function api(pathname, { token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { res, status: res.status, json };
}

/**
 * Insert a user for a test, portable across SQLite and PostgreSQL (explicit id; suites run one at a time).
 * Returns the inserted row (id, name, role, cluster_id, ...).
 */
// phoneValid defaults to 1 (the column default): sessions of users without a valid phone are refused
export async function insertTestUser(dbConn, { name, role, clusterId = 1, phone = null, phoneValid = 1, passwordHash = 'hash' }) {
  const next = await dbConn.query('SELECT COALESCE(MAX(id), 1000) + 1 AS id FROM users');
  const id = Math.max(Number(next.rows[0].id), 2000);
  await dbConn.query(
    `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, 1, $8)`,
    [id, name, role, phone, phoneValid, passwordHash, clusterId, new Date().toISOString().slice(0, 19).replace('T', ' ')]
  );
  const r = await dbConn.query('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0];
}

// Well-known ids from server/data.demo.js, DEV_DEMO_ACCOUNTS and tests/fixtures
export const IDS = {
  admin: 950,
  manager: 100,
  agent1: 1,
  agent2: 2,
  agent3: 3,
  agent4: 4,
  devAgent: 6,
  delivery: 50
};
