/**
 * Guards that keep automated tests away from real databases.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function initDbWith(env) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "const { db } = await import('./server/db.js'); await db.init(); console.log('MODE=' + db.mode); await db.close();"],
    { cwd: repoRoot, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000 }
  );
}

describe('Test database safety guard', () => {
  test('db.init refuses a DATABASE_URL in test mode (before any connection attempt)', () => {
    const r = initDbWith({ LINECART_TEST_MODE: '1', DATABASE_URL: 'postgresql://user:pw@203.0.113.1:5432/prod' });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /Refusing to run tests with DATABASE_URL set/);
  });

  test('the local-PostgreSQL opt-in never allows a non-local host', () => {
    for (const url of ['postgresql://u:p@db.example.supabase.co:5432/postgres', 'postgresql://u:p@10.0.0.5:5432/x', 'postgresql://u:p@localhost.evil.com:5432/x']) {
      const r = initDbWith({ LINECART_TEST_MODE: '1', LINECART_ALLOW_LOCAL_PG: '1', DATABASE_URL: url });
      assert.notStrictEqual(r.status, 0, url);
      assert.match(r.stderr, /Refusing to run tests with DATABASE_URL set/);
    }
  });

  test('db.init refuses to run without a disposable LOCAL_DB_PATH in test mode', () => {
    const r = initDbWith({ LINECART_TEST_MODE: '1', DATABASE_URL: '', LOCAL_DB_PATH: '' });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /Tests require LOCAL_DB_PATH/);
  });

  test('the runner-provided database is local (SQLite, or the opted-in local PostgreSQL)', () => {
    const r = initDbWith({});
    assert.strictEqual(r.status, 0, r.stderr);
    const expected = process.env.LINECART_ALLOW_LOCAL_PG === '1' && process.env.DATABASE_URL ? 'postgres' : 'embedded-postgres-compat';
    assert.match(r.stdout, new RegExp(`MODE=${expected}`));
  });
});
