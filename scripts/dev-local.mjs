/**
 * Start LineCart locally against a disposable SQLite database (never a remote database).
 *   node scripts/dev-local.mjs            -> http://localhost:3001 (serves client/dist)
 * Uses LINECART_TEST_MODE so .env files are ignored and DATABASE_URL is refused.
 * Demo accounts from server/data.demo.js are seeded (development credentials only).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(repoRoot, 'server', 'data');
fs.mkdirSync(dataDir, { recursive: true });

process.env.DATABASE_URL = '';
process.env.LINECART_TEST_MODE = '1';
process.env.LOCAL_DB_PATH = process.env.LOCAL_DB_PATH || path.join(dataDir, 'dev-local.db');
process.env.NODE_ENV = 'development';
process.env.PORT = process.env.PORT || '3001';

console.log(`[dev-local] SQLite database: ${process.env.LOCAL_DB_PATH}`);
await import(pathToFileURL(path.join(repoRoot, 'server', 'index.js')).href);
