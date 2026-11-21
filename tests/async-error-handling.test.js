/**
 * PR-1: rejected promises and thrown errors in route handlers must become 500 JSON responses
 * instead of crashing the process.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from '../server/node_modules/express/index.js';
import { wrapAsyncRoutes, errorMiddleware, requestIdMiddleware, asyncRoute } from '../server/http-errors.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let base;

before(async () => {
  const app = express();
  wrapAsyncRoutes(app);
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.get('/ok', async (req, res) => res.json({ status: 200, ok: true }));
  app.get('/reject', async () => {
    await new Promise((r) => setTimeout(r, 5));
    throw new Error('simulated database failure: connection terminated');
  });
  app.get('/throw', () => {
    throw new Error('sync failure');
  });
  app.post('/echo', async (req, res) => res.json({ status: 200, body: req.body }));
  app.get(['/a', '/b'], async (req, res) => res.json({ status: 200, path: req.path }));
  app.use(errorMiddleware);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

describe('Async route error handling', () => {
  test('a rejected promise returns 500 JSON with a request id and does not crash', async () => {
    const res = await fetch(`${base}/reject`);
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.strictEqual(body.status, 500);
    assert.ok(body.requestId, 'requestId returned');
    assert.strictEqual(res.headers.get('x-request-id'), body.requestId);
    assert.ok(!JSON.stringify(body).includes('connection terminated'), 'internal error text is not leaked');
    const again = await fetch(`${base}/ok`);
    assert.strictEqual(again.status, 200, 'server keeps serving after the failure');
  });

  test('a synchronous throw returns 500 JSON', async () => {
    const res = await fetch(`${base}/throw`);
    assert.strictEqual(res.status, 500);
    assert.strictEqual((await res.json()).status, 500);
  });

  test('invalid JSON returns 400 with the existing message', async () => {
    const res = await fetch(`${base}/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).message, 'Invalid JSON request payload.');
  });

  test('successful requests and multi-path routes are unaffected', async () => {
    const r1 = await fetch(`${base}/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    assert.deepStrictEqual((await r1.json()).body, { a: 1 });
    const r2 = await fetch(`${base}/b`);
    assert.strictEqual((await r2.json()).path, '/b');
  });

  test('asyncRoute leaves error middleware (4 args) untouched', () => {
    const errHandler = (err, req, res, next) => next(err);
    assert.strictEqual(asyncRoute(errHandler), errHandler);
  });

  test('server/index.js wraps routes before registering any of them', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'server/index.js'), 'utf8');
    const wrapAt = src.indexOf('wrapAsyncRoutes(app);');
    const firstRoute = src.search(/\napp\.(get|post|put|delete|use)\(/);
    assert.ok(wrapAt > 0 && wrapAt < firstRoute, 'wrapAsyncRoutes(app) must precede the first route');
    assert.ok(src.includes('app.use(errorMiddleware);'));
  });
});

describe('Real server', () => {
  test('existing endpoints still respond through the wrapper', async () => {
    const res = await fetch('http://localhost:3001/api/system/mode');
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 200);
    assert.ok(res.headers.get('x-request-id'));
  });

  test('a real route that throws inside an async handler returns 500 and the server stays up', async () => {
    const { tokenFor, api, IDS } = await import('./helpers/session.mjs');
    const adminToken = await tokenFor(IDS.admin);
    // period as a number makes the handler call .trim() on a non-string: previously an unhandled rejection
    const r = await api('/api/admin/targets', { token: adminToken, method: 'POST', body: { agentId: 1, period: 202611, targetAmount: 100 } });
    assert.strictEqual(r.status, 500);
    assert.strictEqual(r.json.status, 500);
    const health = await fetch('http://localhost:3001/api/health');
    assert.strictEqual(health.status, 200, 'process is still alive');
  });

  test('unknown API routes still return the JSON 404', async () => {
    const res = await fetch('http://localhost:3001/api/does-not-exist');
    assert.strictEqual(res.status, 404);
    assert.strictEqual((await res.json()).status, 404);
  });
});
