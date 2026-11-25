/**
 * Tests for mandatory first-login password change enforcement in backend & API.
 * Ensures:
 * 1. User with must_change_password=1 receives mustChangePassword: true on login.
 * 2. GET /api/auth/me is accessible and returns mustChangePassword: true.
 * 3. All protected business operations (shops, orders, reports, customer creation)
 *    are blocked with HTTP 403 PASSWORD_CHANGE_REQUIRED.
 * 4. POST /api/auth/change-password succeeds and clears must_change_password to 0.
 * 5. Subsequent business operations are unlocked and succeed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { BASE_URL, initTestDb, insertTestUser, tokenFor } from './helpers/session.mjs';

const db = await initTestDb();

const scrypt = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};

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

test('Mandatory first-login password change enforcement suite', async (t) => {
  const testUserId = 8801;
  const testPhone = '9870008801';
  const initialPassword = 'TempPassword#2026';
  const newPassword = 'Permanent#Secure2026';

  // Cleanup any leftover user
  await db.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
  await db.query('DELETE FROM users WHERE id = $1', [testUserId]);

  // Insert test Field Sales Agent with must_change_password = 1
  await db.query(
    `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
     VALUES ($1, $2, $3, $4, 1, $5, 1, 1, 1, $6)`,
    [testUserId, 'Test Temp Agent', 'Field Sales Agent', testPhone, scrypt(initialPassword), '2026-04-01 09:00:00']
  );

  // 1. Sign in with temporary credentials
  const loginRes = await call('/login', {
    method: 'POST',
    body: { phone: testPhone, password: initialPassword }
  });

  assert.strictEqual(loginRes.status, 200, 'Login succeeds with temporary password');
  assert.ok(loginRes.json.token, 'Session token is returned');
  assert.strictEqual(loginRes.json.result[0].mustChangePassword, true, 'Login payload marks mustChangePassword: true');

  const token = loginRes.json.token;
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 2. GET /api/auth/me should succeed and return mustChangePassword: true
  const meRes = await call('/api/auth/me', { headers: authHeaders });
  assert.strictEqual(meRes.status, 200, 'GET /api/auth/me is allowed');
  assert.strictEqual(meRes.json.user.mustChangePassword, true, 'User payload shows mustChangePassword: true');

  // 3. Protected business operations must be BLOCKED with HTTP 403 PASSWORD_CHANGE_REQUIRED
  const blockedShops = await call('/api/shops', { headers: authHeaders });
  assert.strictEqual(blockedShops.status, 403, 'GET /api/shops is refused');
  assert.strictEqual(blockedShops.json.code, 'PASSWORD_CHANGE_REQUIRED', 'Refusal code is PASSWORD_CHANGE_REQUIRED');

  const blockedClusterInfo = await call('/clusterinfo', { headers: authHeaders });
  assert.strictEqual(blockedClusterInfo.status, 403, 'GET /clusterinfo is refused');
  assert.strictEqual(blockedClusterInfo.json.code, 'PASSWORD_CHANGE_REQUIRED');

  const blockedHomeReport = await call('/gethomereport', { headers: authHeaders });
  assert.strictEqual(blockedHomeReport.status, 403, 'GET /gethomereport is refused');
  assert.strictEqual(blockedHomeReport.json.code, 'PASSWORD_CHANGE_REQUIRED');

  const blockedOrders = await call('/api/orders', { headers: authHeaders });
  assert.strictEqual(blockedOrders.status, 403, 'GET /api/orders is refused');
  assert.strictEqual(blockedOrders.json.code, 'PASSWORD_CHANGE_REQUIRED');

  // 4. Change password via self-service POST /api/auth/change-password
  const changeRes = await call('/api/auth/change-password', {
    method: 'POST',
    headers: authHeaders,
    body: {
      userId: testUserId,
      currentPassword: initialPassword,
      newPassword: newPassword
    }
  });

  assert.strictEqual(changeRes.status, 200, 'Password change succeeds');

  // Verify in database that must_change_password is now 0
  const userInDb = (await db.query('SELECT must_change_password FROM users WHERE id = $1', [testUserId])).rows[0];
  assert.strictEqual(Number(userInDb.must_change_password), 0, 'Database record updated to must_change_password = 0');

  // 5. Subsequent business operations are now UNBLOCKED
  const allowedMe = await call('/api/auth/me', { headers: authHeaders });
  assert.strictEqual(allowedMe.status, 200);
  assert.strictEqual(allowedMe.json.user.mustChangePassword, false, 'mustChangePassword is now false in auth me');

  const allowedShops = await call('/api/shops', { headers: authHeaders });
  assert.strictEqual(allowedShops.status, 200, 'GET /api/shops is now allowed');

  const allowedCluster = await call('/clusterinfo', { headers: authHeaders });
  assert.strictEqual(allowedCluster.status, 200, 'GET /clusterinfo is now allowed');

  // 6. Old temporary password no longer works
  const oldLogin = await call('/login', {
    method: 'POST',
    body: { phone: testPhone, password: initialPassword }
  });
  assert.strictEqual(oldLogin.status, 401, 'Old temporary password is rejected');

  // 7. New password signs in cleanly with mustChangePassword: false
  const newLogin = await call('/login', {
    method: 'POST',
    body: { phone: testPhone, password: newPassword }
  });
  assert.strictEqual(newLogin.status, 200, 'New password signs in successfully');
  assert.strictEqual(newLogin.json.result[0].mustChangePassword, false, 'mustChangePassword is false');

  // Cleanup test user
  await db.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
  await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
});
