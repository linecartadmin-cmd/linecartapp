/**
 * Starts a second, private LineCart server for suites that send write probes
 * (the route access sweep). It always uses its own brand-new SQLite file in the OS temp
 * folder, never the shared test database and never PostgreSQL, so probes cannot affect
 * other suites. Refuses to start if the port is taken.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

export async function startIsolatedServer({ port = 3002 } = {}) {
  if (await portInUse(port)) throw new Error(`Port ${port} is already in use.`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linecart-iso-'));
  const env = {
    ...process.env,
    DATABASE_URL: '',
    LINECART_ALLOW_LOCAL_PG: '',
    NODE_ENV: 'test',
    APP_ENV: '',
    RENDER: '',
    LINECART_TEST_MODE: '1',
    LOCAL_DB_PATH: path.join(tmpDir, 'linecart-iso.db'),
    PORT: String(port),
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    INITIAL_ADMIN_PHONE: '',
    INITIAL_ADMIN_PASSWORD: ''
  };
  delete env.NODE_TEST_CONTEXT;
  const logPath = path.join(tmpDir, 'server.log');
  const log = fs.openSync(logPath, 'w');
  const child = spawn(process.execPath, ['server/index.js'], { cwd: repoRoot, env, stdio: ['ignore', log, log] });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok && (await res.json())?.database?.mode === 'embedded-postgres-compat') { ready = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.closeSync(log); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };
  if (!ready) {
    const out = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-2000) : '';
    await stop();
    throw new Error(`Isolated server did not start.\n${out}`);
  }
  const seedOut = execFileSync(process.execPath, [path.join(repoRoot, 'tests/helpers/isolated-seed.mjs')], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const tokens = JSON.parse(seedOut.split('@@TOKENS@@')[1].split('\n')[0]);
  return { base, tokens, logPath, stop, child };
}
