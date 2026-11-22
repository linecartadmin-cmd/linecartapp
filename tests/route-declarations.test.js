/**
 * Route declarations (Phase 0, T0.1): the declaration table matches the routes in the source,
 * and the registration wrapper refuses undeclared, duplicate or missing routes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_DECLARATIONS, ROLES, STAFF_ROLES, canonicalRole, installRouteDeclarations } from '../server/access.js';
import { EXPECTED_NON_STAFF, expectedAudience } from './helpers/expected-audiences.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every app.<method>(path | [paths], ...) call in the server source, found by text, not by running it. */
function scanSourceRoutes() {
  const keys = [];
  for (const file of fs.readdirSync(path.join(repoRoot, 'server')).filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(repoRoot, 'server', file), 'utf8');
    for (const m of text.matchAll(/\bapp\.(get|post|put|patch|delete|all)\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`[^`]*`)\s*,/g)) {
      for (const p of m[2].match(/'[^']*'|"[^"]*"|`[^`]*`/g)) keys.push(`${m[1].toUpperCase()} ${p.slice(1, -1)}`);
    }
    // Registrations the pattern above cannot read (variables, routers) would escape the check
    assert.doesNotMatch(text, /\bapp\.(get|post|put|patch|delete|all)\(\s*[A-Za-z_$]/, `${file}: route path must be a literal`);
    assert.doesNotMatch(text, /express\.Router\(|\bapp\.route\(/, `${file}: routers are not covered by the declarations`);
  }
  return keys;
}

test('the declaration table lists exactly the routes registered in server/*.js', () => {
  const source = scanSourceRoutes();
  assert.equal(new Set(source).size, source.length, 'a route is registered twice');
  assert.deepEqual([...source].sort(), Object.keys(ROUTE_DECLARATIONS).sort());
});

test('role list is closed and staff roles are unchanged', () => {
  assert.deepEqual([...STAFF_ROLES], ['Admin', 'Sales Manager', 'Field Sales Agent', 'Delivery Agent']);
  assert.deepEqual([...ROLES], [...STAFF_ROLES, 'Customer']);
  assert.equal(canonicalRole('admin'), 'Admin');
  assert.equal(canonicalRole(' Sales Manager '), 'Sales Manager');
  assert.equal(canonicalRole('Auditor'), null);
  assert.equal(canonicalRole(''), null);
});

function fakeApp() {
  const calls = [];
  const app = {};
  for (const m of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    app[m] = (...args) => { calls.push([m, ...args]); return app; };
  }
  return { app, calls };
}

test('registering an undeclared route refuses startup', () => {
  const { app } = fakeApp();
  installRouteDeclarations(app, { getCaller: () => null, declarations: { 'GET /a': 'staff' } });
  assert.throws(() => app.get('/b', () => {}), /no access declaration/);
  assert.throws(() => app.post('/a', () => {}), /no access declaration/);
});

test('a declared route that is never registered refuses startup', () => {
  const { app } = fakeApp();
  const access = installRouteDeclarations(app, { getCaller: () => null, declarations: { 'GET /a': 'staff', 'GET /b': 'public' } });
  app.get('/a', () => {});
  assert.throws(() => access.assertComplete(), /never registered: GET \/b/);
  app.get('/b', () => {});
  assert.equal(access.assertComplete(), 2);
});

test('duplicates, mixed-audience aliases and non-string paths are refused; settings reads pass through', () => {
  const { app, calls } = fakeApp();
  installRouteDeclarations(app, { getCaller: () => null, declarations: { 'GET /a': 'staff', 'GET /p': 'public' } });
  app.get('trust proxy');
  assert.deepEqual(calls[0], ['get', 'trust proxy']);
  app.get('/a', () => {});
  assert.throws(() => app.get('/a', () => {}), /registered twice/);
  assert.throws(() => app.get(['/p', '/a'], () => {}), /registered twice|one audience/);
  assert.throws(() => app.get(/regex/, () => {}), /must be strings/);
});

function run(gate, caller) {
  let statusCode = 200; let body = null; let nexted = false;
  const res = { status(c) { statusCode = c; return res; }, json(b) { body = b; return res; } };
  gate({}, res, () => { nexted = true; });
  return { statusCode, body, nexted };
}

test('the audience gate admits only the declared roles and leaves public routes untouched', () => {
  const { app, calls } = fakeApp();
  let caller = null;
  installRouteDeclarations(app, {
    getCaller: () => caller,
    authFailureCode: () => 'AUTH_REQUIRED',
    declarations: { 'GET /pub': 'public', 'GET /self': 'self', 'GET /acct': 'account', 'GET /staff': 'staff', 'GET /cust': 'customer' }
  });
  const handler = () => {};
  for (const p of ['/pub', '/self', '/acct', '/staff', '/cust']) app.get(p, handler);
  const gateOf = (p) => calls.find((c) => c[1] === p);
  assert.equal(gateOf('/pub').length, 3, 'public routes get no gate');
  const cases = [
    // [path, role or null, expected status]
    ['/self', null, 401], ['/self', 'Auditor', 200], ['/self', 'Customer', 200], ['/self', 'Admin', 200],
    ['/acct', null, 401], ['/acct', 'Auditor', 403], ['/acct', 'Customer', 200], ['/acct', 'Delivery Agent', 200],
    ['/staff', null, 401], ['/staff', 'Auditor', 403], ['/staff', 'Customer', 403], ['/staff', 'customer', 403],
    ['/staff', 'Admin', 200], ['/staff', 'admin', 200], ['/staff', 'Sales Manager', 200],
    ['/staff', 'Field Sales Agent', 200], ['/staff', 'Delivery Agent', 200],
    ['/cust', null, 401], ['/cust', 'Customer', 200], ['/cust', 'Admin', 403], ['/cust', 'Auditor', 403]
  ];
  for (const [p, role, want] of cases) {
    caller = role ? { id: 1, role } : null;
    const r = run(gateOf(p)[2], caller);
    const got = r.nexted ? 200 : r.statusCode;
    assert.equal(got, want, `${p} as ${role}`);
    if (want === 401) { assert.equal(r.body.status, 401); assert.equal(r.body.code, 'AUTH_REQUIRED'); }
    if (want === 403) { assert.equal(r.body.status, 403); assert.equal(r.body.code, 'ROLE_NOT_ALLOWED'); }
  }
});

// ---------------------------------------------------------------- Stage A review, M1
test('M1: only the independently reviewed routes are non-staff; every other route is staff-only', () => {
  const wrong = [];
  for (const [key, audience] of Object.entries(ROUTE_DECLARATIONS)) {
    if (audience !== expectedAudience(key)) wrong.push(`${key}: declared ${audience}, expected ${expectedAudience(key)}`);
  }
  for (const key of Object.keys(EXPECTED_NON_STAFF)) {
    if (!ROUTE_DECLARATIONS[key]) wrong.push(`${key}: expected ${EXPECTED_NON_STAFF[key]} but the route is not declared`);
  }
  assert.deepEqual(wrong, []);
  // Spot checks that must never become public
  for (const key of ['GET /api/shops', 'GET /api/orders', 'GET /api/admin/users', 'POST /createorder', 'GET /api/uploads/shops/:filename']) {
    assert.equal(ROUTE_DECLARATIONS[key], 'staff', key);
  }
});

// ---------------------------------------------------------------- Stage A review, L4
/**
 * Every app.use(...) call in server/*.js with its argument text. A call either closes on its own
 * line ("app.use(x);") or, for inline middleware, at the next line that is exactly "});" (the
 * project's formatting). Comments and regex literals inside middleware therefore cannot confuse it.
 */
function scanAppUse() {
  const calls = [];
  for (const file of fs.readdirSync(path.join(repoRoot, 'server')).filter((f) => f.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(repoRoot, 'server', file), 'utf8').split(/\r?\n/);
    lines.forEach((lineText, idx) => {
      const at = lineText.search(/\bapp\.use\(/);
      if (at < 0 || /^\s*(\/\/|\*)/.test(lineText)) return;
      const rest = lineText.slice(at + 'app.use('.length);
      let args;
      if (/\);\s*$/.test(rest)) {
        args = rest.replace(/\);\s*$/, '');
      } else {
        const end = lines.findIndex((l, j) => j > idx && /^\}\);\s*$/.test(l));
        args = end < 0 ? null : [rest, ...lines.slice(idx + 1, end), '}'].join('\n');
      }
      calls.push({ file, line: idx + 1, args: args === null ? null : args.trim() });
    });
  }
  return calls;
}

// Reviewed middleware that sends a reply itself: CORS answers preflight (204) and refuses unknown origins (403)
const RESPONDING_MIDDLEWARE_MARKERS = ['Access-Control-Allow-Origin'];
const NAMED_MIDDLEWARE = new Set(['requestIdMiddleware', 'errorMiddleware']);
const INLINE_MIDDLEWARE_COUNT = 5; // reviewed in Stage A; adding one needs a review and this number changed

test('L4: app.use() cannot register routes outside the declaration mechanism', () => {
  const calls = scanAppUse();
  const problems = [];
  let inline = 0;
  for (const { file, line, args } of calls) {
    const where = `${file}:${line}`;
    if (file !== 'index.js') { problems.push(`${where}: app.use outside server/index.js`); continue; }
    if (args === null || args.length > 5000) { problems.push(`${where}: could not read this app.use call`); continue; }
    const pathArg = /^(['"`])([^'"`]*)\1\s*,\s*([\s\S]*)$/.exec(args);
    if (pathArg) {
      // A mounted path may only serve static files, and never under /api
      if (!/^express\.static\(/.test(pathArg[3])) problems.push(`${where}: path "${pathArg[2]}" is mounted with something other than express.static`);
      if (/^\/api(\/|$)/i.test(pathArg[2])) problems.push(`${where}: static mount under /api`);
      continue;
    }
    if (NAMED_MIDDLEWARE.has(args) || /^express\.(json|urlencoded|static)\(/.test(args)) continue;
    if (/^(async\s+)?(\(\s*req\s*,\s*res\s*,\s*next\s*\)|function\b)/.test(args)) {
      inline++;
      const sendsReply = /\bres\b[^;\n]*\.(json|send|sendFile|sendStatus|end|redirect|render)\(/.test(args);
      if (sendsReply && !RESPONDING_MIDDLEWARE_MARKERS.some((m) => args.includes(m))) {
        problems.push(`${where}: inline middleware sends a reply itself`);
      }
      continue;
    }
    problems.push(`${where}: unreviewed app.use(${args.slice(0, 60)})`);
  }
  if (inline !== INLINE_MIDDLEWARE_COUNT) problems.push(`expected ${INLINE_MIDDLEWARE_COUNT} reviewed inline middleware, found ${inline}`);
  assert.deepEqual(problems, []);
  // The legitimate uses are still there
  const all = calls.map((c) => c.args).join('\n');
  for (const needle of ['requestIdMiddleware', 'express.json(', 'express.urlencoded(', "'/items', express.static(", 'express.static(clientDist)', 'errorMiddleware']) {
    assert.ok(all.includes(needle), `expected app.use with ${needle}`);
  }
});
