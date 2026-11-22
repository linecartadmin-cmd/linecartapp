/**
 * API contract test (Phase 0, T0.18 contract component).
 *
 * 1. docs/openapi.json is generated from the route declarations and is up to date.
 * 2. Against a private server (own throwaway SQLite), for every route and every identity:
 *    JSON bodies mirror the HTTP status in `status`, 401/403 bodies from protected routes carry a
 *    documented `code`, and legacy aliases answer exactly like the paths they alias.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROUTE_DECLARATIONS } from '../server/access.js';
import { buildOpenApi, renderOpenApi, OPENAPI_PATH, AUTH_401_CODES, AUTH_403_CODES } from '../scripts/generate-openapi.mjs';
import { startIsolatedServer } from './helpers/isolated-server.mjs';
import { concretePath, SESSION_ENDING, SWEEP_IDENTITIES } from './helpers/route-probes.mjs';

// Paths that answer for the same handler (kept for installed apps and the legacy admin panel)
const ALIAS_GROUPS = [
  ['POST /login', 'POST /api/linecart/login', 'POST /admin_panel/public/api/linecart/login'],
  ['GET /health', 'GET /api/health'],
  ['GET /users/:id', 'GET /api/users/:id'],
  ['GET /gethomereport', 'GET /api/linecart/gethomereport', 'GET /admin_panel/public/api/linecart/gethomereport'],
  ['GET /clusterinfo', 'GET /api/linecart/clusterinfo', 'GET /admin_panel/public/api/linecart/clusterinfo'],
  ['POST /addcustomer', 'POST /api/linecart/addcustomer', 'POST /admin_panel/public/api/linecart/addcustomer'],
  ['GET /getitemsorder', 'GET /api/linecart/getitemsorder', 'GET /admin_panel/public/api/linecart/getitemsorder'],
  ['POST /createorder', 'POST /api/linecart/createorder', 'POST /admin_panel/public/api/linecart/createorder'],
  ['GET /api/shops/:shopId/order-history', 'GET /api/linecart/shops/:shopId/order-history'],
  ['PUT /api/shops/:shopId/assign', 'POST /api/shops/:shopId/assign-agent', 'POST /api/admin/shops/:shopId/assign'],
  ['GET /api/manager/assigned-agents', 'GET /api/manager/:managerId/assigned-agents']
];
// /health keeps its own legacy body ({ status: 'healthy' }); the web app shell is HTML
const STATUS_FIELD_EXCEPTIONS = new Set(['GET /health', 'GET /api/health', 'GET *']);

test('docs/openapi.json is generated from the declarations and up to date', () => {
  assert.ok(fs.existsSync(OPENAPI_PATH), 'run: node scripts/generate-openapi.mjs');
  assert.equal(fs.readFileSync(OPENAPI_PATH, 'utf8').replace(/\r\n/g, '\n'), renderOpenApi(),
    'docs/openapi.json is out of date; run: node scripts/generate-openapi.mjs');
});

test('the OpenAPI description covers every declared route with its audience and auth replies', () => {
  const doc = buildOpenApi();
  const described = [];
  for (const [p, ops] of Object.entries(doc.paths)) {
    for (const [m, op] of Object.entries(ops)) {
      const key = `${m.toUpperCase()} ${p.replace(/\{([A-Za-z]+)\}/g, ':$1')}`;
      described.push(key);
      assert.equal(op['x-linecart-audience'], ROUTE_DECLARATIONS[key], key);
      if (ROUTE_DECLARATIONS[key] === 'public') {
        assert.deepEqual(op.security, [], key);
      } else {
        assert.ok(op.responses[401] && op.responses[403], key);
        assert.ok(op.security.length > 0, key);
      }
    }
  }
  if (doc['x-linecart-fallback']) described.push('GET *');
  assert.deepEqual(described.sort(), Object.keys(ROUTE_DECLARATIONS).sort());
  assert.equal(new Set(doc.paths && Object.values(doc.paths).flatMap((o) => Object.values(o).map((x) => x.operationId))).size,
    described.length - (doc['x-linecart-fallback'] ? 1 : 0), 'operation ids are unique');
  for (const group of ALIAS_GROUPS) for (const k of group) assert.ok(ROUTE_DECLARATIONS[k], `alias ${k} is declared`);
});

test('every route keeps the response contract for every identity', async (t) => {
  const srv = await startIsolatedServer({ port: 3003 });
  t.after(() => srv.stop());
  const keys = [...Object.keys(ROUTE_DECLARATIONS).filter((k) => !SESSION_ENDING.includes(k)), ...SESSION_ENDING];
  const statusOf = {};
  const problems = [];
  for (const who of SWEEP_IDENTITIES) {
    for (const key of keys) {
      const method = key.slice(0, key.indexOf(' '));
      const routePath = key.slice(key.indexOf(' ') + 1);
      const headers = { 'Content-Type': 'application/json' };
      if (who !== 'none') { headers.Authorization = `Bearer ${srv.tokens[who]}`; headers['X-Session-Token'] = srv.tokens[who]; }
      const res = await fetch(srv.base + concretePath(routePath), {
        method, headers, body: method === 'GET' || method === 'DELETE' ? undefined : '{}'
      });
      statusOf[`${who} ${key}`] = res.status;
      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      if (STATUS_FIELD_EXCEPTIONS.has(key)) continue;
      if (!isJson) { problems.push(`${who} ${key}: not JSON (${res.status})`); continue; }
      const body = await res.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) { problems.push(`${who} ${key}: body is not an object`); continue; }
      if (body.status !== res.status && !(res.status === 200 && body.status === 1)) {
        problems.push(`${who} ${key}: HTTP ${res.status} but status=${JSON.stringify(body.status)}`);
      }
      if (ROUTE_DECLARATIONS[key] !== 'public') {
        if (res.status === 401 && !AUTH_401_CODES.includes(body.code)) problems.push(`${who} ${key}: 401 code ${body.code}`);
        if (res.status === 403 && !AUTH_403_CODES.includes(body.code)) problems.push(`${who} ${key}: 403 code ${body.code}`);
      }
    }
  }
  for (const group of ALIAS_GROUPS) {
    for (const who of SWEEP_IDENTITIES) {
      const seen = new Set(group.map((k) => statusOf[`${who} ${k}`]));
      if (seen.size !== 1) problems.push(`${who}: aliases ${group.join(' | ')} answer ${[...seen].join('/')}`);
    }
  }
  assert.deepEqual(problems, []);
});
