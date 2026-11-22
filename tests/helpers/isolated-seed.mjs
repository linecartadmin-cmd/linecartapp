/**
 * Child-process seeder for tests/helpers/isolated-server.mjs.
 * Runs with LINECART_TEST_MODE=1, DATABASE_URL='' and a private LOCAL_DB_PATH, so it can only
 * touch that throwaway SQLite file. Seeds the shared fixtures, adds synthetic users for roles that
 * do not exist in the app (an invented role and a future Customer role), creates one session per
 * identity and prints {identity: rawToken} as JSON on stdout.
 */
import crypto from 'node:crypto';

if (process.env.LINECART_TEST_MODE !== '1' || !process.env.LOCAL_DB_PATH || (process.env.DATABASE_URL || '').trim()) {
  console.error('isolated-seed may only run against a private test SQLite file.');
  process.exit(1);
}

const { db } = await import('../../server/db.js');
const { seedTestFixtures } = await import('../fixtures/seed-test-fixtures.mjs');
await db.init();
await seedTestFixtures(db);

const synthetic = [
  { id: 2901, name: 'Synthetic Auditor', role: 'Auditor', phone: '9876502901' },
  { id: 2902, name: 'Synthetic Customer', role: 'Customer', phone: '9876502902' }
];
for (const u of synthetic) {
  await db.query(
    `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
     VALUES ($1, $2, $3, $4, 1, 'hash', 0, 1, 1, '2026-04-01 09:00:00') ON CONFLICT (id) DO NOTHING`,
    [u.id, u.name, u.role, u.phone]
  );
}

const identities = { admin: 950, manager: 100, agent: 1, delivery: 50, auditor: 2901, customer: 2902 };
const tokens = {};
const now = Date.now();
for (const [key, userId] of Object.entries(identities)) {
  const raw = `iso-${key}-${crypto.randomUUID()}`;
  const role = (await db.query('SELECT role FROM users WHERE id = $1', [userId])).rows[0]?.role;
  if (!role) throw new Error(`fixture user ${userId} missing`);
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, role, is_dev_admin, created_at, last_seen, expires_at, revoked_at)
     VALUES ($1, $2, $3, 0, $4, $4, $5, NULL)`,
    [crypto.createHash('sha256').update(raw).digest('hex'), userId, role, now, now + 3600 * 1000]
  );
  tokens[key] = raw;
}
await db.close();
process.stdout.write(`\n@@TOKENS@@${JSON.stringify(tokens)}\n`);
