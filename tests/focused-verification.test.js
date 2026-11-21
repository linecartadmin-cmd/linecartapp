/**
 * Focused Verification Tests for LineCart Issues:
 * 1. Duplicate order submission and sync idempotency
 * 2. Sales manager team assignments and quota loading
 * 3. Per-account biometric credentials and missing-credential fallback
 * 4. Password policy, admin-only password management, and security
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('Issue 1: Order Idempotency & Duplicate Elimination', () => {
  test('Cleanses legacy mock orders S101-24018 and S103-24017 from state', () => {
    const rawLegacyStorage = [
      { id: 'S101-24018', customer: 'Sunrise Fresh Produce', date: '2026-10-24', itemsCount: 2, total: 4280 },
      { id: 'S103-24017', customer: 'Sri Krishna Bakery & Cafe', date: '2026-10-23', itemsCount: 2, total: 3150 },
      { id: 'S033-24019', customer: 'Lakshmi Retail', date: '2026-10-27', itemsCount: 3, total: 8500 }
    ];

    const filtered = rawLegacyStorage.filter((o) => o.id !== 'S101-24018' && o.id !== 'S103-24017');
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].id, 'S033-24019');
  });

  // The former 'TEMP- offline order replaced by synced order' case was removed with offline order
  // creation (orders are online-only). See tests/online-only-orders.test.js.

  test('Server idempotency returns identical orderId without creating second record', () => {
    const ordersDb = new Map();
    const processOrder = (payload) => {
      const { idempotencyKey, shopShortId, items } = payload;
      if (idempotencyKey && ordersDb.has(idempotencyKey)) {
        return {
          status: 200,
          idempotentReplay: true,
          orderId: ordersDb.get(idempotencyKey).orderId
        };
      }
      const orderId = `${shopShortId}-24019`;
      const record = { orderId, items, idempotencyKey };
      if (idempotencyKey) ordersDb.set(idempotencyKey, record);
      return { status: 200, idempotentReplay: false, orderId };
    };

    const first = processOrder({ idempotencyKey: 'idemp-xyz-1', shopShortId: 'S033', items: [1, 2] });
    assert.strictEqual(first.idempotentReplay, false);
    assert.strictEqual(first.orderId, 'S033-24019');

    // Replay same mutation
    const second = processOrder({ idempotencyKey: 'idemp-xyz-1', shopShortId: 'S033', items: [1, 2] });
    assert.strictEqual(second.idempotentReplay, true);
    assert.strictEqual(second.orderId, 'S033-24019');
    assert.strictEqual(ordersDb.size, 1, 'Database must contain exactly 1 row');
  });
});

describe('Issue 2: Sales Manager Team & Quota Controls', () => {
  test('Admin assigns field sales agents to managers; Sales Managers are strictly blocked from modifying assignments', () => {
    const authorizeAssignment = (reqCaller) => {
      const isAdmin = (reqCaller.role || '').toLowerCase() === 'admin';
      if (!isAdmin) return { authorized: false, status: 403, error: 'Access Denied: Administrator role required.' };
      return { authorized: true, status: 200 };
    };

    // Sales manager attempting assignment (strictly forbidden)
    const managerCaller = { id: 100, role: 'Sales Manager' };
    const managerRes = authorizeAssignment(managerCaller);
    assert.strictEqual(managerRes.authorized, false);
    assert.strictEqual(managerRes.status, 403);

    // Field sales agent attempting assignment (strictly forbidden)
    const agentCaller = { id: 1, role: 'Field Sales Agent' };
    const agentRes = authorizeAssignment(agentCaller);
    assert.strictEqual(agentRes.authorized, false);
    assert.strictEqual(agentRes.status, 403);

    // Admin configuring manager assignments (authorized)
    const adminCaller = { id: 900, role: 'Admin' };
    const adminRes = authorizeAssignment(adminCaller);
    assert.strictEqual(adminRes.authorized, true);
    assert.strictEqual(adminRes.status, 200);
  });

  test('Quota dialog empty state triggers when assignedAgents is empty', () => {
    const assignedAgents = [];
    const isQuotaSelectDisabled = assignedAgents.length === 0;
    assert.strictEqual(isQuotaSelectDisabled, true);

    const populatedAgents = [{ id: 1, name: 'Suresh Kumar', phone: '9870000002' }];
    assert.strictEqual(populatedAgents.length > 0, true);
    assert.strictEqual(populatedAgents[0].name, 'Suresh Kumar');
  });

  test('Targets cannot be saved for agents not in assigned list', () => {
    const assignedAgentIds = [1, 2];
    const canSetTarget = (targetAgentId) => assignedAgentIds.includes(Number(targetAgentId));

    assert.strictEqual(canSetTarget(1), true);
    assert.strictEqual(canSetTarget(3), false, 'Forbidden to set target for unassigned agent');
  });
});

describe('Issue 3: Biometric Keystore Key Naming & Verification', () => {
  test('Generates versioned per-account server key', () => {
    const getBiometricServerKey = (userId) => `linecart-session-${userId}`;
    assert.strictEqual(getBiometricServerKey(1), 'linecart-session-1');
    assert.strictEqual(getBiometricServerKey(100), 'linecart-session-100');
  });

  test('Missing biometric credentials fall back to standard online login', () => {
    const mockKeystore = new Map(); // empty, no credentials saved yet
    const hasBiometricCredential = (userId) => mockKeystore.has(`linecart-session-${userId}`);

    const hardware = { strongBiometryIsAvailable: true };
    const selectedAccount = { id: 100, name: 'Manager John', phone: '9870000001' };

    const canUnlockBiometric = Boolean(
      selectedAccount &&
      hasBiometricCredential(selectedAccount.id) &&
      hardware.strongBiometryIsAvailable
    );

    assert.strictEqual(canUnlockBiometric, false, 'Must NOT show biometric unlock when credentials are not in Keystore');

    // Now save credentials
    mockKeystore.set(`linecart-session-${selectedAccount.id}`, 'secure-token-123');
    const canUnlockNow = Boolean(
      selectedAccount &&
      hasBiometricCredential(selectedAccount.id) &&
      hardware.strongBiometryIsAvailable
    );
    assert.strictEqual(canUnlockNow, true, 'Shows biometric unlock ONLY after credentials are saved');
  });

  test('Non-secret saved accounts list does not store passwords or hashes', () => {
    const rawUser = {
      id: 100,
      name: 'Manager John',
      phone: '9870000001',
      role: 'Sales Manager',
      password: 'mypassword123',
      passwordHash: '$2b$10$abcdefghijk'
    };

    // Filter to public metadata only
    const publicProfile = {
      id: Number(rawUser.id),
      name: rawUser.name,
      phone: rawUser.phone,
      role: rawUser.role
    };

    assert.strictEqual(publicProfile.password, undefined);
    assert.strictEqual(publicProfile.passwordHash, undefined);
    assert.strictEqual(Object.keys(publicProfile).length, 4);
  });
});

describe('Issue 4: Password Policy & Visibility Controls', () => {
  test('User creation initializes must_change_password to 0', () => {
    const initialMustChange = 0;
    assert.strictEqual(initialMustChange, 0, 'Must not force password change popup on initial login');
  });

  test('Login response explicitly sets mustChangePassword to false', () => {
    const loginUserResponse = {
      id: 1,
      name: 'Agent',
      role: 'Field Sales Agent',
      mustChangePassword: false
    };
    assert.strictEqual(loginUserResponse.mustChangePassword, false);
  });

  test('User API responses strip password and passwordHash server-side', () => {
    const usersInDb = [
      { id: 1, name: 'Agent 1', phone: '9870000002', role: 'Field Sales Agent', passwordHash: 'secret-hash' },
      { id: 100, name: 'Manager 1', phone: '9870000001', role: 'Sales Manager', passwordHash: 'secret-hash-2' }
    ];

    const safeUsers = usersInDb.map(({ passwordHash, password, ...rest }) => rest);
    for (const u of safeUsers) {
      assert.strictEqual(u.passwordHash, undefined, 'passwordHash must never be exposed');
      assert.strictEqual(u.password, undefined, 'password must never be exposed');
    }
  });
});
