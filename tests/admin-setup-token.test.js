/**
 * PR-5: initial Administrator setup requires SETUP_TOKEN in production and never touches existing accounts.
 * Each scenario runs its own production-mode server on a fresh disposable database.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'setup-token-for-tests-0123456789abcdef';
const children = [];

async function startServer(port, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linecart-setup-'));
  const dbPath = path.join(dir, 'db.sqlite');
  let output = '';
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      LOCAL_DB_PATH: dbPath,
      NODE_ENV: 'production',
      SETUP_TOKEN: '',
      INITIAL_ADMIN_PHONE: '',
      INITIAL_ADMIN_PASSWORD: '',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  children.push(child);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/ping`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return { base: `http://127.0.0.1:${port}`, dbPath, child, logs: () => output };
}

const setup = (base, body, token) =>
  fetch(`${base}/api/system/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token !== undefined ? { Authorization: `Setup ${token}` } : {}) },
    body: JSON.stringify(body)
  });

after(() => {
  for (const c of children) c.kill();
});

describe('Production without SETUP_TOKEN', () => {
  test('setup is reported unavailable and refused with 403', async () => {
    const s = await startServer(3111);
    const mode = await (await fetch(`${s.base}/api/system/mode`)).json();
    assert.strictEqual(mode.requiresAdminSetup, true);
    assert.strictEqual(mode.setupAvailable, false);
    const r = await setup(s.base, { phone: '9811111111', password: 'Str0ng-pass!' });
    assert.strictEqual(r.status, 403);
    assert.match((await r.json()).message, /disabled/);
  });
});

describe('Production with SETUP_TOKEN', () => {
  let s;

  test('missing or wrong token is refused with 403', async () => {
    s = await startServer(3112, { SETUP_TOKEN: TOKEN });
    const mode = await (await fetch(`${s.base}/api/system/mode`)).json();
    assert.strictEqual(mode.setupTokenRequired, true);
    assert.strictEqual(mode.setupAvailable, true);

    assert.strictEqual((await setup(s.base, { phone: '9811111111', password: 'Str0ng-pass!' })).status, 403);
    assert.strictEqual((await setup(s.base, { phone: '9811111111', password: 'Str0ng-pass!' }, 'wrong-token-wrong-token-wrong')).status, 403);
    // A session-style Bearer header is not accepted as a setup token
    const bearer = await fetch(`${s.base}/api/system/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ phone: '9811111111', password: 'Str0ng-pass!' })
    });
    assert.strictEqual(bearer.status, 403);
  });

  test('an existing (unconfigured) admin row is never overwritten', async () => {
    const sqlite = new DatabaseSync(s.dbPath);
    sqlite.prepare(
      `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
       VALUES (900, 'Old Admin', 'Admin', '9822222222', 1, NULL, 1, 1, 1, '2026-01-01 00:00:00')`
    ).run();
    sqlite.close();

    const takeover = await setup(s.base, { name: 'Attacker', phone: '9822222222', password: 'Str0ng-pass!' }, TOKEN);
    assert.strictEqual(takeover.status, 400, 'existing phone cannot be claimed');

    const ok = await setup(s.base, { name: 'New Admin', phone: '9833333333', password: 'Str0ng-pass!' }, TOKEN);
    assert.strictEqual(ok.status, 201);

    const check = new DatabaseSync(s.dbPath);
    const old = check.prepare('SELECT name, phone, password_hash FROM users WHERE id = 900').get();
    const created = check.prepare("SELECT id, role FROM users WHERE phone = '9833333333'").get();
    check.close();
    assert.strictEqual(old.name, 'Old Admin');
    assert.strictEqual(old.phone, '9822222222');
    assert.strictEqual(old.password_hash, null);
    assert.strictEqual(created.role, 'Admin');
    assert.notStrictEqual(Number(created.id), 900);
  });

  test('once configured, setup is closed even with the token', async () => {
    const again = await setup(s.base, { phone: '9844444444', password: 'Str0ng-pass!' }, TOKEN);
    assert.strictEqual(again.status, 403);
    const mode = await (await fetch(`${s.base}/api/system/mode`)).json();
    assert.strictEqual(mode.requiresAdminSetup, false);
  });

  test('the setup token never appears in server logs', () => {
    assert.ok(!s.logs().includes(TOKEN), 'token leaked into logs');
  });
});
