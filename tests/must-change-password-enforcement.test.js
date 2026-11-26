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

test('Admin user management and password reset mustChangePassword suite', async (t) => {
  const adminId = 900;
  const adminPhone = '6381168811';
  const adminPass = 'AdminSecretPass#1';

  // Ensure Admin exists and has a session
  await db.query('DELETE FROM sessions WHERE user_id = $1', [adminId]);
  await db.query('DELETE FROM users WHERE id = $1', [adminId]);
  await db.query(
    `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
     VALUES ($1, $2, 'Admin', $3, 1, $4, 0, 1, 1, '2026-04-01 09:00:00')`,
    [adminId, 'LineCart Administrator', adminPhone, scrypt(adminPass)]
  );

  const rawAdminToken = 'admin-test-token-' + crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(rawAdminToken).digest('hex');
  const now = Date.now();
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, role, is_dev_admin, created_at, last_seen, expires_at, revoked_at)
     VALUES ($1, $2, 'Admin', 1, $3, $4, $5, NULL)`,
    [tokenHash, adminId, now, now, now + 86400000]
  );
  const adminHeaders = { Authorization: `Bearer ${rawAdminToken}` };

  // 1. Admin creates a user with mustChangePassword = true (default)
  const agentPhone = '6381568999';
  const initialAgentPass = 'InitialAgent#Pass1';
  await db.query('DELETE FROM users WHERE phone = $1', [agentPhone]);

  const createRes = await call('/api/admin/users', {
    method: 'POST',
    headers: adminHeaders,
    body: {
      name: 'Agent Test Multi',
      phone: agentPhone,
      role: 'Field Sales Agent',
      password: initialAgentPass,
      mustChangePassword: true,
      clusterid: 1
    }
  });

  assert.strictEqual(createRes.status, 201, 'Admin successfully created agent');
  const createdAgentId = createRes.json.user.id;
  assert.ok(createdAgentId > 0);

  // Check database state
  let dbRow = (await db.query('SELECT must_change_password FROM users WHERE id = $1', [createdAgentId])).rows[0];
  assert.strictEqual(Number(dbRow.must_change_password), 1, 'Initial creation has must_change_password = 1');

  // Check GET /api/admin/users returns mustChangePassword
  const usersListRes = await call('/api/admin/users', { headers: adminHeaders });
  assert.strictEqual(usersListRes.status, 200);
  const targetInList = usersListRes.json.users.find((u) => u.id === createdAgentId);
  assert.strictEqual(targetInList.mustChangePassword, true, 'Admin users list reflects mustChangePassword: true');

  // 2. Admin resets password without specifying mustChangePassword -> should clear to 0
  const resetPass1 = 'AdminReset#NewPass1';
  const resetRes1 = await call(`/api/admin/users/${createdAgentId}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: {
      name: 'Agent Test Multi',
      phone: agentPhone,
      role: 'Field Sales Agent',
      password: resetPass1,
      clusterid: 1,
      active: 1
    }
  });
  assert.strictEqual(resetRes1.status, 200, 'Admin reset password successfully');

  dbRow = (await db.query('SELECT must_change_password FROM users WHERE id = $1', [createdAgentId])).rows[0];
  assert.strictEqual(Number(dbRow.must_change_password), 0, 'Admin reset without mustChangePassword clears flag to 0');

  // 3. Admin resets password with explicit mustChangePassword: true -> should set to 1
  const resetPass2 = 'AdminReset#NewPass2';
  const resetRes2 = await call(`/api/admin/users/${createdAgentId}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: {
      name: 'Agent Test Multi',
      phone: agentPhone,
      role: 'Field Sales Agent',
      password: resetPass2,
      mustChangePassword: true,
      clusterid: 1,
      active: 1
    }
  });
  assert.strictEqual(resetRes2.status, 200);
  dbRow = (await db.query('SELECT must_change_password FROM users WHERE id = $1', [createdAgentId])).rows[0];
  assert.strictEqual(Number(dbRow.must_change_password), 1, 'Admin reset with mustChangePassword: true sets flag to 1');

  // 4. Admin updates user without password change but with mustChangePassword: false -> should clear to 0
  const resetRes3 = await call(`/api/admin/users/${createdAgentId}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: {
      name: 'Agent Test Multi',
      phone: agentPhone,
      role: 'Field Sales Agent',
      mustChangePassword: false,
      clusterid: 1,
      active: 1
    }
  });
  assert.strictEqual(resetRes3.status, 200);
  dbRow = (await db.query('SELECT must_change_password FROM users WHERE id = $1', [createdAgentId])).rows[0];
  assert.strictEqual(Number(dbRow.must_change_password), 0, 'Admin edit with mustChangePassword: false clears flag to 0');

  // 5. Agent signs in with resetPass2 -> gets mustChangePassword: false, unblocked access to visits and shops
  const agentLogin = await call('/login', {
    method: 'POST',
    body: { phone: agentPhone, password: resetPass2 }
  });
  assert.strictEqual(agentLogin.status, 200, 'Agent logs in with Admin-reset password');
  assert.strictEqual(agentLogin.json.result[0].mustChangePassword, false, 'mustChangePassword is false');

  const agentToken = agentLogin.json.token;
  const agentHeaders = { Authorization: `Bearer ${agentToken}` };

  const shopsRes = await call('/api/shops', { headers: agentHeaders });
  assert.strictEqual(shopsRes.status, 200, 'Agent can access /api/shops without 403');

  const visitsRes = await call('/api/visits/my-shops', { headers: agentHeaders });
  assert.strictEqual(visitsRes.status, 200, 'Agent can access /api/visits/my-shops without 403');

  // Cleanup
  await db.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [adminId, createdAgentId]);
  await db.query('DELETE FROM users WHERE id IN ($1, $2)', [adminId, createdAgentId]);
});
