/**
 * Session hardening and response codes (Phase 0, T0.8).
 * Synthetic users and sessions only, on the disposable test database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { BASE_URL, initTestDb, insertTestUser, tokenFor, IDS } from './helpers/session.mjs';

const db = await initTestDb();
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const scrypt = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };

async function call(pathname, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(BASE_URL + pathname, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function sessionRow(token) {
  return (await db.query('SELECT revoked_at, expires_at FROM sessions WHERE token_hash = $1', [sha(token)])).rows[0];
}

async function removeUser(id) {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await db.query('DELETE FROM users WHERE id = $1', [id]);
}

test('every combination of Authorization, X-Session-Token and X-Token is resolved or refused', async () => {
  const t1 = await tokenFor(IDS.agent1);
  const t2 = await tokenFor(IDS.agent2);
  const values = { absent: null, t1, t2, garbage: 'not-a-real-session-token' };
  const names = Object.keys(values);
  let checked = 0;
  for (const a of names) for (const s of names) for (const x of names) {
    const headers = {};
    if (values[a]) headers.Authorization = `Bearer ${values[a]}`;
    if (values[s]) headers['X-Session-Token'] = values[s];
    if (values[x]) headers['X-Token'] = values[x];
    const sent = [values[a], values[s], values[x]].filter(Boolean);
    const distinct = [...new Set(sent)];
    const r = await call('/api/auth/me', { headers });
    const label = `Authorization=${a} X-Session-Token=${s} X-Token=${x}`;
    if (sent.length === 0) {
      assert.equal(r.status, 401, label); assert.equal(r.json.code, 'AUTH_REQUIRED', label);
    } else if (distinct.length > 1) {
      assert.equal(r.status, 401, label); assert.equal(r.json.code, 'AUTH_CONFLICT', label);
    } else if (distinct[0] === values.garbage) {
      assert.equal(r.status, 401, label); assert.equal(r.json.code, 'SESSION_INVALID', label);
    } else {
      assert.equal(r.status, 200, label);
      assert.equal(r.json.user.id, distinct[0] === t1 ? IDS.agent1 : IDS.agent2, label);
    }
    checked++;
  }
  assert.equal(checked, 64);
});

test('the headers the installed apps send keep working (Authorization + X-Session-Token, same token)', async () => {
  const t = await tokenFor(IDS.delivery);
  const r = await call('/api/delivery/orders', { headers: { Authorization: `Bearer ${t}`, 'X-Session-Token': t } });
  assert.equal(r.status, 200);
  // Each header alone, and a lower-case scheme, as before
  for (const headers of [{ Authorization: `Bearer ${t}` }, { 'X-Session-Token': t }, { 'X-Token': t }, { Authorization: `bearer ${t}` }]) {
    assert.equal((await call('/api/auth/me', { headers })).status, 200, JSON.stringify(Object.keys(headers)));
  }
});

test('malformed credentials are refused with AUTH_MALFORMED, with no fallback to another header', async () => {
  const t = await tokenFor(IDS.agent1);
  const cases = [
    { Authorization: 'Bearer' },
    { Authorization: 'Bearer ', 'X-Session-Token': t },
    { Authorization: `Basic ${t}` },
    { Authorization: `Basic ${t}`, 'X-Session-Token': t },
    { Authorization: 'Setup some-setup-token' },
    { Authorization: `Bearer ${t} extra` },
    { 'X-Session-Token': `${t} ${t}` }
  ];
  for (const headers of cases) {
    const r = await call('/api/auth/me', { headers });
    assert.equal(r.status, 401, JSON.stringify(headers));
    assert.equal(r.json.code, 'AUTH_MALFORMED', JSON.stringify(headers));
  }
});

test('cookies are never used as a credential', async () => {
  const t = await tokenFor(IDS.agent1);
  for (const cookie of [`session=${t}`, `token=${t}`, `LineCartPref_token=${t}`]) {
    const alone = await call('/api/auth/me', { headers: { Cookie: cookie } });
    assert.equal(alone.status, 401); assert.equal(alone.json.code, 'AUTH_REQUIRED');
    const withBadHeader = await call('/api/auth/me', { headers: { Cookie: cookie, Authorization: 'Bearer revoked-or-unknown' } });
    assert.equal(withBadHeader.status, 401); assert.equal(withBadHeader.json.code, 'SESSION_INVALID');
  }
});

test('expired, revoked and deactivated sessions answer SESSION_EXPIRED or SESSION_INVALID', async () => {
  const expired = 'test-expired-' + crypto.randomUUID();
  const past = Date.now() - 60_000;
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, role, is_dev_admin, created_at, last_seen, expires_at, revoked_at)
     VALUES ($1, $2, 'Field Sales Agent', 0, $3, $3, $4, NULL)`,
    [sha(expired), IDS.agent1, past - 3600_000, past]
  );
  let r = await call('/api/shops', { headers: { Authorization: `Bearer ${expired}` } });
  assert.equal(r.status, 401); assert.equal(r.json.code, 'SESSION_EXPIRED');
  assert.ok((await sessionRow(expired)).revoked_at, 'expired session is closed');

  const t = await tokenFor(IDS.agent1);
  assert.equal((await call('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).status, 200);
  r = await call('/api/shops', { headers: { Authorization: `Bearer ${t}` } });
  assert.equal(r.status, 401); assert.equal(r.json.code, 'SESSION_INVALID');

  const u = await insertTestUser(db, { name: 'T08 Inactive', role: 'Field Sales Agent', phone: '9876508001' });
  const tu = await tokenFor(u.id);
  assert.equal((await call('/api/auth/me', { headers: { Authorization: `Bearer ${tu}` } })).status, 200);
  await db.query('UPDATE users SET active = 0 WHERE id = $1', [u.id]);
  r = await call('/api/auth/me', { headers: { Authorization: `Bearer ${tu}` } });
  assert.equal(r.status, 401); assert.equal(r.json.code, 'SESSION_INVALID');
  await removeUser(u.id);
});

test('401 and 403 bodies keep status and message and gain a code; public sign-in replies are unchanged', async () => {
  const agent = await tokenFor(IDS.agent1);
  const denied = await call('/api/admin/users', { headers: { Authorization: `Bearer ${agent}` } });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.status, 403);
  assert.equal(typeof denied.json.message, 'string');
  assert.equal(denied.json.code, 'FORBIDDEN');

  const none = await call('/api/admin/users');
  assert.equal(none.status, 401);
  assert.equal(none.json.status, 401);
  assert.equal(none.json.code, 'AUTH_REQUIRED');

  const login = await call('/login', { method: 'POST', body: { phone: '9876599999', password: 'wrong-password-1' } });
  assert.equal(login.status, 401);
  assert.equal(login.json.code, undefined);
  assert.deepEqual(login.json.result, []);

  // A stale token on a public route is ignored
  assert.equal((await call('/api/system/mode', { headers: { Authorization: 'Bearer stale-token' } })).status, 200);
});

test('POST /api/auth/logout-all signs the user out on every device', async () => {
  const u = await insertTestUser(db, { name: 'T08 Multi Device', role: 'Field Sales Agent', phone: '9876508002' });
  const phone = await tokenFor(u.id);
  const tablet = await tokenFor(u.id);
  const other = await tokenFor(IDS.agent2);
  assert.equal((await call('/api/auth/logout-all', { method: 'POST' })).status, 401);
  const r = await call('/api/auth/logout-all', { method: 'POST', headers: { Authorization: `Bearer ${phone}`, 'X-Session-Token': phone } });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 200);
  assert.equal(r.json.revokedSessions, 2);
  for (const t of [phone, tablet]) {
    const me = await call('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } });
    assert.equal(me.status, 401); assert.equal(me.json.code, 'SESSION_INVALID');
  }
  assert.equal((await call('/api/auth/me', { headers: { Authorization: `Bearer ${other}` } })).status, 200, 'other users stay signed in');
  await removeUser(u.id);
});

test('own password change signs out other devices and keeps this one (R14)', async () => {
  const oldPw = 'Synthetic-Old-Pass-1';
  const u = await insertTestUser(db, { name: 'T08 Password', role: 'Delivery Agent', phone: '9876508003', passwordHash: scrypt(oldPw) });
  const here = await tokenFor(u.id);
  const elsewhere = await tokenFor(u.id);
  const r = await call('/api/auth/change-password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${here}`, 'X-Session-Token': here },
    body: { currentPassword: oldPw, newPassword: 'Synthetic-New-Pass-2' }
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.message, 'Password changed successfully.');
  assert.equal(r.json.revokedSessions, 1);
  assert.equal((await call('/api/auth/me', { headers: { Authorization: `Bearer ${here}` } })).status, 200, 'this device stays signed in');
  const gone = await call('/api/auth/me', { headers: { Authorization: `Bearer ${elsewhere}` } });
  assert.equal(gone.status, 401); assert.equal(gone.json.code, 'SESSION_INVALID');
  await removeUser(u.id);
});

test('an admin changing another user password signs that user out everywhere', async () => {
  const oldPw = 'Synthetic-Old-Pass-3';
  const u = await insertTestUser(db, { name: 'T08 Admin Reset', role: 'Field Sales Agent', phone: '9876508004', passwordHash: scrypt(oldPw) });
  const userToken = await tokenFor(u.id);
  const admin = await tokenFor(IDS.admin);
  const r = await call('/api/auth/change-password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin}` },
    body: { userId: u.id, currentPassword: oldPw, newPassword: 'Synthetic-New-Pass-4' }
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.revokedSessions, 1);
  assert.equal((await call('/api/auth/me', { headers: { Authorization: `Bearer ${userToken}` } })).status, 401);
  assert.equal((await call('/api/auth/me', { headers: { Authorization: `Bearer ${admin}` } })).status, 200);
  await removeUser(u.id);
});
