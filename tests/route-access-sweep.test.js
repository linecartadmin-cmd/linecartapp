/**
 * Route access sweep (Phase 0, T0.1 / T0.18).
 *
 * Probes every declared route as: no token, a future Customer, an invented role ("Auditor"),
 * and each of the four staff roles, on a private server with its own throwaway SQLite file.
 * Probes use ids that do not exist and empty bodies, so they cannot reach a real record.
 *
 * tests/fixtures/route-access-baseline.json holds the statuses recorded on the code before
 * Phase 0 (commit 2f958df). Every difference from it must be listed in INTENDED below with
 * its task; anything else fails the test, so behaviour for current users cannot drift silently.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_DECLARATIONS } from '../server/access.js';
import { startIsolatedServer } from './helpers/isolated-server.mjs';
import { sweep } from './helpers/route-probes.mjs';
import { expectedAudience } from './helpers/expected-audiences.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'route-access-baseline.json'), 'utf8'));

/** Expected status for one probe: baseline, adjusted by the intended Stage A changes. */
function expectedStatus(who, method, routePath) {
  const key = `${method} ${routePath}`;
  // M1: the audience comes from the independent list, never from server/access.js
  const audience = expectedAudience(key);
  const explicit = INTENDED[`${who} ${key}`];
  if (explicit !== undefined) return explicit;
  // T0.1: the closed role list. Unknown roles and the reserved Customer role are refused on staff routes;
  // unknown roles are also refused on account routes (own password change).
  if ((who === 'customer' || who === 'auditor') && audience === 'staff') return 403;
  if (who === 'auditor' && audience === 'account') return 403;
  return BASELINE[`${who} ${key}`];
}

// Explicit per-probe changes, each with the task that makes it
const INTENDED = {
  // T0.3: a missing or unknown role in PUT /api/admin/permissions is 400 INVALID_ROLE (was 404 not found)
  'admin PUT /api/admin/permissions': 400,
  // T0.8: new route POST /api/auth/logout-all (any valid session; sign out everywhere)
  'none POST /api/auth/logout-all': 401,
  ...Object.fromEntries(['customer', 'auditor', 'delivery', 'agent', 'manager', 'admin'].map((who) => [`${who} POST /api/auth/logout-all`, 200]))
};

test('every declared route answers as recorded, apart from the intended Stage A changes', async (t) => {
  const routes = Object.keys(ROUTE_DECLARATIONS).map((k) => {
    const i = k.indexOf(' ');
    return { method: k.slice(0, i), path: k.slice(i + 1) };
  });
  const srv = await startIsolatedServer({ port: 3002 });
  t.after(() => srv.stop());
  const actual = await sweep(srv.base, srv.tokens, routes);
  const mismatches = [];
  for (const [probeKey, status] of Object.entries(actual)) {
    const [who, method, ...rest] = probeKey.split(' ');
    const want = expectedStatus(who, method, rest.join(' '));
    if (want === undefined) mismatches.push(`${probeKey}: no baseline or intended status (got ${status})`);
    else if (status !== want) mismatches.push(`${probeKey}: expected ${want}, got ${status}`);
  }
  assert.deepEqual(mismatches, []);
  // The baseline must not contain routes that no longer exist
  const declared = new Set(Object.keys(ROUTE_DECLARATIONS));
  const stale = [...new Set(Object.keys(BASELINE).map((k) => k.split(' ').slice(1).join(' ')))].filter((k) => !declared.has(k));
  assert.deepEqual(stale, []);
});
