#!/usr/bin/env node
// READ-ONLY production check, run by the owner in their own terminal:
//   node scripts/prod-status-check.mjs https://linecart-staging.onrender.com
// Signs in as an Admin (phone and password are typed here and sent only to that server), reads
// GET /api/admin/orders and counts order statuses. Lists any order whose status is not one of the
// seven the new status rules recognise; those orders cannot be moved by any role after the
// deployment (the API answers 409; nothing is written). It changes no data. The token is never
// printed or stored.
import readline from 'node:readline';

const RECOGNISED = ['Pending', 'In progress', 'Price approval pending', 'Picked up', 'Delivered', 'Could not deliver', 'Cancelled'];
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  console.error('Usage: node scripts/prod-status-check.mjs https://<server>');
  process.exit(2);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
const write = rl._writeToOutput?.bind(rl);
if (write) rl._writeToOutput = (str) => { if (!muted) write(str); };
const lines = rl[Symbol.asyncIterator]();
async function ask(question, hidden = false) {
  process.stdout.write(question);
  muted = hidden;
  const { value } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write('\n');
  return String(value || '').trim();
}

const phone = await ask('Admin phone: ');
const password = await ask('Admin password (hidden): ', true);
rl.close();
const login = await (await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) })).json().catch(() => null);
const token = login?.token;
if (!token) {
  console.error('Sign-in failed:', login?.message || 'no response');
  process.exit(1);
}
const res = await fetch(`${base}/api/admin/orders`, { headers: { Authorization: `Bearer ${token}`, 'X-Session-Token': token } });
const body = await res.json().catch(() => null);
const orders = body?.orders || body?.result || [];
if (res.status !== 200 || !Array.isArray(orders)) {
  console.error(`Could not read orders (HTTP ${res.status}).`);
  process.exit(1);
}
const counts = {};
const unknown = [];
for (const o of orders) {
  const s = o.status === null || o.status === undefined || o.status === '' ? '(empty: treated as In progress)' : String(o.status);
  counts[s] = (counts[s] || 0) + 1;
  if (!RECOGNISED.includes(s) && !s.startsWith('(empty')) unknown.push(`${o.orderId || o.id} (${s})`);
}
console.log(`Orders read: ${orders.length}`);
for (const [s, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${s}: ${n}`);
console.log(unknown.length ? `UNRECOGNISED statuses (${unknown.length}): ${unknown.join(', ')}` : 'No unrecognised statuses.');
