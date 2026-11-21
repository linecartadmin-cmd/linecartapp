/**
 * LineCart test runner (`npm test`).
 *
 * Safety rules:
 *  - Refuses to start if DATABASE_URL is set in the environment.
 *  - Always uses a brand-new disposable SQLite file in the OS temp folder.
 *  - Starts its own API server in LINECART_TEST_MODE (which ignores .env files).
 *  - Refuses to start if something is already listening on the test port, so tests can never
 *    talk to a server that is connected to a real database.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PORT = 3001; // existing suites call http://localhost:3001

if ((process.env.DATABASE_URL || '').trim()) {
  console.error('[test] DATABASE_URL is set. Unset it before running tests; tests delete data.');
  process.exit(1);
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

if (await portInUse(PORT)) {
  console.error(`[test] Port ${PORT} is already in use. Stop the other server first so tests cannot reach it.`);
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linecart-test-'));
const testEnv = {
  ...process.env,
  DATABASE_URL: '',
  NODE_ENV: 'test',
  APP_ENV: '',
  RENDER: '',
  LINECART_TEST_MODE: '1',
  LOCAL_DB_PATH: path.join(tmpDir, 'linecart-test.db'),
  PORT: String(PORT),
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  INITIAL_ADMIN_PHONE: '',
  INITIAL_ADMIN_PASSWORD: ''
};
Object.assign(process.env, testEnv);

const requested = process.argv.slice(2);
const testFiles = (requested.length ? requested : fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort())
  .map((f) => path.resolve(__dirname, path.basename(f)));

let server;
function stopServer() {
  if (server && server.exitCode === null) server.kill();
}

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('Test server exited during startup.');
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) {
        const body = await res.json();
        if (body?.database?.mode !== 'embedded-postgres-compat') {
          throw new Error(`Test server is not using the disposable SQLite database (mode: ${body?.database?.mode}).`);
        }
        return;
      }
    } catch (err) {
      if (String(err.message).includes('disposable')) throw err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Timed out waiting for the test server.');
}

function runNodeTest(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', file], {
      cwd: repoRoot,
      env: testEnv,
      stdio: 'inherit'
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function resetOrders() {
  const { db } = await import('../server/db.js');
  await db.init();
  await db.query("DELETE FROM price_requests WHERE order_id NOT IN ('S101-24019')");
  await db.query("DELETE FROM order_items WHERE order_id NOT IN ('S101-24019')");
  await db.query("DELETE FROM orders WHERE order_id NOT IN ('S101-24019')");
  await db.close();
}

const results = [];
try {
  const logPath = path.join(tmpDir, 'server.log');
  const log = fs.openSync(logPath, 'w');
  server = spawn(process.execPath, ['server/index.js'], { cwd: repoRoot, env: testEnv, stdio: ['ignore', log, log] });
  await waitForHealth();
  console.log(`[test] Server ready on :${PORT} using ${testEnv.LOCAL_DB_PATH}`);
  {
    const { db } = await import('../server/db.js');
    const { seedTestFixtures } = await import('./fixtures/seed-test-fixtures.mjs');
    await db.init();
    await seedTestFixtures(db);
    await db.close();
  }

  for (const file of testFiles) {
    console.log(`\n=== ${path.basename(file)} ===`);
    const code = await runNodeTest(file);
    results.push({ file: path.basename(file), ok: code === 0 });
    await resetOrders();
  }
} catch (err) {
  console.error('[test] Runner error:', err.message);
  results.push({ file: 'runner', ok: false });
} finally {
  stopServer();
  await new Promise((r) => setTimeout(r, 500));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log('\n=== Summary ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} suite(s) failed` : 'All suites passed');
process.exit(failed ? 1 : 0);
