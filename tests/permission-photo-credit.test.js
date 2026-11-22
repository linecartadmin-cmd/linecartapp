/**
 * Phase 0 Stage A: permission role lock (T0.3), shop photo ownership (T0.4) and
 * credited-salesperson validation (T0.6). Synthetic records on the disposable test database;
 * the test photo is a few bytes written to the gitignored local uploads folder and removed after.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, initTestDb, insertTestUser, tokenFor, IDS } from './helpers/session.mjs';

const db = await initTestDb();
const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'uploads', 'shops');

// ---------------------------------------------------------------- T0.3
test('T0.3: permissions can be changed only for the three editable staff roles', async () => {
  const admin = await tokenFor(IDS.admin);
  const before = (await db.query('SELECT role, pages_json, actions_json FROM role_permissions ORDER BY role')).rows;
  for (const role of ['Auditor', 'Customer', 'sales manager', 'SALES MANAGER', ' Delivery Agent', '', null, 42, ['Sales Manager']]) {
    const r = await api('/api/admin/permissions', { token: admin, method: 'PUT', body: { role, pages: [], actions: [] } });
    assert.equal(r.status, 400, `role ${JSON.stringify(role)}`);
    assert.equal(r.json.code, 'INVALID_ROLE');
  }
  // Admin keeps its own refusal message
  const adminRole = await api('/api/admin/permissions', { token: admin, method: 'PUT', body: { role: 'Admin', pages: [] } });
  assert.equal(adminRole.status, 400);
  assert.match(adminRole.json.message, /immutable/);
  const after = (await db.query('SELECT role, pages_json, actions_json FROM role_permissions ORDER BY role')).rows;
  assert.deepEqual(after, before, 'nothing was written');

  // A valid role still saves (written back unchanged)
  const current = await api('/api/admin/permissions', { token: admin });
  assert.equal(current.status, 200);
  const perms = current.json.permissions || current.json.rolePermissions || current.json;
  const da = perms['Delivery Agent'];
  assert.ok(da && Array.isArray(da.actions), 'Delivery Agent permissions are readable');
  const ok = await api('/api/admin/permissions', { token: admin, method: 'PUT', body: { role: 'Delivery Agent', pages: da.pages, actions: da.actions } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.permissions['Delivery Agent'].actions, da.actions);

  // Non-admins are still refused
  const mgr = await api('/api/admin/permissions', { token: await tokenFor(IDS.manager), method: 'PUT', body: { role: 'Field Sales Agent' } });
  assert.equal(mgr.status, 403);
});

// ---------------------------------------------------------------- T0.4
test('T0.4: a shop photo is served only to callers allowed that shop', async (t) => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const name = `shop_33_${crypto.randomUUID()}.jpg`;
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
  fs.writeFileSync(path.join(uploadsDir, name), bytes);
  const orderId = 'T04-DA-0001';
  t.after(async () => {
    try { fs.unlinkSync(path.join(uploadsDir, name)); } catch {}
    await db.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
  });

  const get = async (who) => {
    const res = await fetch(`http://localhost:3001/api/uploads/shops/${name}`, { headers: { Authorization: `Bearer ${await tokenFor(who)}` } });
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
  };

  // Shop 33 is assigned to Agent 2
  const owner = await get(IDS.agent2);
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body, bytes);
  assert.equal((await get(IDS.admin)).status, 200);
  assert.equal((await get(IDS.agent1)).status, 403, 'another field agent is refused (was 200)');
  assert.equal((await get(IDS.delivery)).status, 403, 'a delivery agent without a delivery there is refused');

  await db.query(
    `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name,
                         cluster_id, order_date, expected_delivery_date, created_at, status, items_count, total,
                         delivery_agent_id, payment_status, payment_amount_collected, payment_balance_due)
     VALUES ($1, 990001, 'S033', 33, 'Test Shop 33', 'Retail', $2, 'Test Agent', 1, '2026-11-20', '2026-11-21',
             '2026-11-20T05:00:00.000Z', 'In progress', 0, 0, $3, 'Not collected', 0, 0)`,
    [orderId, IDS.agent2, IDS.delivery]
  );
  assert.equal((await get(IDS.delivery)).status, 200, 'the delivery agent on an open delivery may see it');

  // Manager access follows canCallerAccessShop (team or cluster), as for order history
  const mgrPhoto = (await get(IDS.manager)).status;
  const mgrHistory = (await api('/api/shops/33/order-history', { token: await tokenFor(IDS.manager) })).status;
  assert.equal(mgrPhoto === 200, mgrHistory === 200, 'photo and order history agree for the manager');

  // Unknown shop, bad names and no session
  const none = await fetch(`http://localhost:3001/api/uploads/shops/shop_999999_${crypto.randomUUID()}.jpg`, { headers: { Authorization: `Bearer ${await tokenFor(IDS.admin)}` } });
  assert.equal(none.status, 404);
  const bad = await fetch('http://localhost:3001/api/uploads/shops/not-a-photo.jpg', { headers: { Authorization: `Bearer ${await tokenFor(IDS.admin)}` } });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`http://localhost:3001/api/uploads/shops/${name}`)).status, 401);
});

// ---------------------------------------------------------------- T0.6
function fieldOrder(spersonid, key) {
  const line = { customerid: 101, itemid: 1, qty: 3, clusterid: 1 };
  if (spersonid !== undefined) line.spersonid = spersonid;
  return { idempotencyKey: key, orderList: [line] };
}

test('T0.6: /createorder refuses credit to a missing, inactive or non-sales user', async (t) => {
  const admin = await tokenFor(IDS.admin);
  const inactive = await insertTestUser(db, { name: 'T06 Inactive Agent', role: 'Field Sales Agent', phone: '9876506001' });
  await db.query('UPDATE users SET active = 0 WHERE id = $1', [inactive.id]);
  t.after(async () => { await db.query('DELETE FROM users WHERE id = $1', [inactive.id]); });

  const stamp = Date.now();
  const cases = [
    [999999, 'does not exist'],
    [inactive.id, 'is deactivated'],
    [IDS.delivery, 'is not a sales user'],
    ['abc', 'is not a valid user id']
  ];
  for (const [sp, reason] of cases) {
    const r = await api('/createorder', { token: admin, method: 'POST', body: fieldOrder(sp, `t06-${stamp}-${sp}`) });
    assert.equal(r.status, 400, `credit to ${sp}`);
    assert.equal(r.json.code, 'INVALID_CREDITED_SALESPERSON');
    assert.ok(r.json.message.includes(reason), r.json.message);
    assert.equal(r.json.id, '0');
  }
  const count = await db.query('SELECT COUNT(*) AS n FROM orders WHERE sperson_id IN ($1, $2, $3)', [999999, inactive.id, IDS.delivery]);
  assert.equal(Number(count.rows[0].n), 0, 'no order was written');

  // Valid credits keep working: a field agent for themself, and an admin for an agent or for themself
  const self = await api('/createorder', { token: await tokenFor(IDS.agent1), method: 'POST', body: fieldOrder(IDS.agent1, `t06-${stamp}-self`) });
  assert.equal(self.status, 200, JSON.stringify(self.json));
  const forAgent = await api('/createorder', { token: admin, method: 'POST', body: fieldOrder(IDS.agent1, `t06-${stamp}-adm`) });
  assert.equal(forAgent.status, 200, JSON.stringify(forAgent.json));
  const adminSelf = await api('/createorder', { token: admin, method: 'POST', body: fieldOrder(undefined, `t06-${stamp}-admself`) });
  assert.equal(adminSelf.status, 200, JSON.stringify(adminSelf.json));
});

test('T0.6: a manager cannot credit a deactivated team member', async (t) => {
  const member = await insertTestUser(db, { name: 'T06 Team Member', role: 'Field Sales Agent', phone: '9876506002' });
  await db.query('INSERT INTO manager_assignments (manager_id, agent_id) VALUES ($1, $2)', [IDS.manager, member.id]);
  await db.query('UPDATE users SET active = 0 WHERE id = $1', [member.id]);
  t.after(async () => {
    await db.query('DELETE FROM manager_assignments WHERE agent_id = $1', [member.id]);
    await db.query('DELETE FROM users WHERE id = $1', [member.id]);
    if (savedActions !== null) {
      await db.query("UPDATE role_permissions SET actions_json = $1 WHERE role = 'Sales Manager'", [savedActions]);
    }
  });
  // Managers create orders only when an admin grants create_order; grant it for this test, then restore
  const row = await db.query("SELECT actions_json FROM role_permissions WHERE role = 'Sales Manager'");
  const savedActions = row.rows[0]?.actions_json ?? null;
  assert.ok(savedActions !== null, 'Sales Manager permissions exist');
  const actions = JSON.parse(savedActions);
  if (!actions.includes('create_order')) actions.push('create_order');
  await db.query("UPDATE role_permissions SET actions_json = $1 WHERE role = 'Sales Manager'", [JSON.stringify(actions)]);

  const r = await api('/createorder', { token: await tokenFor(IDS.manager), method: 'POST', body: fieldOrder(member.id, `t06-mgr-${Date.now()}`) });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.code, 'INVALID_CREDITED_SALESPERSON');
  assert.ok(r.json.message.includes('is deactivated'));
  const count = await db.query('SELECT COUNT(*) AS n FROM orders WHERE sperson_id = $1', [member.id]);
  assert.equal(Number(count.rows[0].n), 0);
});

test('T0.6: POST /api/admin/orders validates an explicit spersonId and still defaults to the admin', async () => {
  const admin = await tokenFor(IDS.admin);
  const body = (spersonId) => ({ shopId: 101, ...(spersonId !== undefined ? { spersonId } : {}), orderList: [{ itemid: 1, qty: 2 }] });
  for (const sp of [999999, IDS.delivery, 'abc']) {
    const r = await api('/api/admin/orders', { token: admin, method: 'POST', body: body(sp) });
    assert.equal(r.status, 400, `spersonId ${sp}`);
    assert.equal(r.json.code, 'INVALID_CREDITED_SALESPERSON');
  }
  const forAgent = await api('/api/admin/orders', { token: admin, method: 'POST', body: body(IDS.agent1) });
  assert.ok([200, 201].includes(forAgent.status), JSON.stringify(forAgent.json));
  const forAdmin = await api('/api/admin/orders', { token: admin, method: 'POST', body: body(undefined) });
  assert.ok([200, 201].includes(forAdmin.status), JSON.stringify(forAdmin.json));
  const empty = await api('/api/admin/orders', { token: admin, method: 'POST', body: body('') });
  assert.ok([200, 201].includes(empty.status), 'an empty selection still credits the admin');
  const credited = await db.query('SELECT sperson_id FROM orders WHERE sperson_id IN ($1, $2)', [IDS.agent1, IDS.admin]);
  assert.ok(credited.rows.some((r) => Number(r.sperson_id) === IDS.agent1));
  assert.ok(credited.rows.some((r) => Number(r.sperson_id) === IDS.admin));
});
