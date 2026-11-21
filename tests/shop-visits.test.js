/**
 * GPS-verified shop visits API (Migration 007): the required scenarios plus review, coordinates and settings.
 * Shop 101 (agent 1) is registered at 10.6583, 77.0082.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { tokenFor, api, initTestDb, IDS } from './helpers/session.mjs';

let db;
const T = {};
const SHOP = { id: 101, lat: 10.6583, lng: 77.0082 };
const NEAR = { latitude: 10.65875, longitude: 77.0082 }; // ~50 m north
const FAR = { latitude: 10.6603, longitude: 77.0082 }; // ~222 m north
const OTHER_MANAGER = 120;
let keySeq = 0;

function verify(token, fields = {}) {
  return api('/api/visits/verify', {
    token,
    method: 'POST',
    body: {
      shopId: SHOP.id,
      ...NEAR,
      accuracy: 12,
      platform: 'android',
      mockLocation: 'no',
      fixTimestamp: Date.now() - 2000,
      clientTime: new Date().toISOString(),
      idempotencyKey: `visit-${Date.now()}-${(keySeq += 1)}`,
      ...fields
    }
  });
}
const setSettings = (body) => api('/api/admin/settings', { token: T.admin, method: 'PUT', body });

before(async () => {
  db = await initTestDb();
  // Agent 1: one shop without coordinates (150) and one far away in Thoothukudi (151)
  await db.query(`INSERT INTO shops (shop_id, cluster_id, shop_name, shop_category, owner_name, contact1, contact2, latitude, longitude, address, pincode,
    payment_mode, created_by, assigned_agent_id, photo, active, created_on, survey_json)
    VALUES (150, 1, 'No GPS Shop', 'Retail', 'Owner', '9800000150', '', 0, 0, 'Somewhere', '642001', 0, 1, 1, 'no_image.jpg', 1, '2026-04-01 10:00:00', '[]')
    ON CONFLICT (shop_id) DO NOTHING`);
  await db.query(`INSERT INTO shops (shop_id, cluster_id, shop_name, shop_category, owner_name, contact1, contact2, latitude, longitude, address, pincode,
    payment_mode, created_by, assigned_agent_id, photo, active, created_on, survey_json)
    VALUES (151, 2, 'Far Shop', 'Retail', 'Owner', '9800000151', '', 8.7642, 78.1348, 'Thoothukudi', '628001', 0, 1, 1, 'no_image.jpg', 1, '2026-04-01 10:00:00', '[]')
    ON CONFLICT (shop_id) DO NOTHING`);
  // A second manager who supervises only agent 3
  await db.query(`INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
    VALUES (${OTHER_MANAGER}, 'Other Manager', 'Sales Manager', '9876500120', 1, NULL, 0, 2, 1, '2026-04-01 09:00:00') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO manager_assignments (manager_id, agent_id) VALUES (${OTHER_MANAGER}, 3) ON CONFLICT (manager_id, agent_id) DO NOTHING`);
  await db.query('DELETE FROM shop_visits');
  for (const [k, id] of Object.entries({ agent1: IDS.agent1, agent2: IDS.agent2, agent3: IDS.agent3, manager: IDS.manager, other: OTHER_MANAGER, admin: IDS.admin, delivery: IDS.delivery })) {
    T[k] = await tokenFor(id);
  }
});

after(async () => {
  await setSettings({ visitDuplicateWindowMinutes: 30, visitGeofenceRadiusM: 100, visitMaxGpsAccuracyM: 30 });
});

describe('1-3. Geofence and accuracy', () => {
  test('1. agent within the geofence: visit verified with server time and distance', async () => {
    const r = await verify(T.agent1);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.result, 'verified');
    assert.strictEqual(r.json.message, 'Visit Verified Successfully');
    assert.ok(Math.abs(r.json.visit.distanceM - 50) < 2);
    const serverTime = Date.parse(r.json.visit.visitedAt);
    assert.ok(Math.abs(serverTime - Date.now()) < 10000, 'server timestamp');
  });

  test('2. agent outside the geofence: refused with the measured distance, nothing counted', async () => {
    const r = await verify(T.agent1, FAR);
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.json.result, 'too_far');
    assert.strictEqual(r.json.message, 'You are too far from this shop. Please reach the shop to mark your visit.');
    assert.ok(r.json.visit.distanceM > 200);
    assert.strictEqual(r.json.verified, false);
  });

  test('3. poor GPS accuracy is refused even at the shop', async () => {
    const r = await verify(T.agent1, { latitude: SHOP.lat, longitude: SHOP.lng, accuracy: 45 });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.json.result, 'poor_accuracy');
    assert.strictEqual(r.json.message, 'GPS accuracy is insufficient. Please move to an open area and try again.');
  });

  test('client-supplied distance or status is ignored', async () => {
    const r = await verify(T.agent1, { ...FAR, distanceM: 1, status: 'verified', verified: true });
    assert.strictEqual(r.json.result, 'too_far');
  });
});

describe('4-5. Missing and invalid coordinates', () => {
  test('4. shop without registered coordinates is never verified', async () => {
    const r = await verify(T.agent1, { shopId: 150, latitude: SHOP.lat, longitude: SHOP.lng });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.json.result, 'location_not_registered');
    assert.match(r.json.message, /Shop location not registered/);
  });

  test('5. invalid device coordinates and accuracy are rejected with 400', async () => {
    for (const bad of [{ latitude: 95 }, { longitude: 'abc' }, { latitude: 0, longitude: 0 }, { latitude: null }]) {
      const r = await verify(T.agent1, bad);
      assert.strictEqual(r.status, 400, JSON.stringify(bad));
      assert.strictEqual(r.json.result, 'invalid_coordinates');
    }
    for (const acc of [0, -5, 'x']) {
      const r = await verify(T.agent1, { accuracy: acc });
      assert.strictEqual(r.status, 400, `accuracy ${acc}`);
    }
  });
});

describe('6-7. Authorization', () => {
  test('6. no session, a manager, an admin or a delivery agent cannot record visits', async () => {
    assert.strictEqual((await verify(undefined)).status, 401);
    for (const who of ['manager', 'admin', 'delivery']) {
      assert.strictEqual((await verify(T[who])).status, 403, who);
    }
    assert.strictEqual((await api('/api/visits/my-shops', { token: T.manager })).status, 403);
  });

  test("7. an agent cannot submit another agent's shop", async () => {
    const r = await verify(T.agent2); // shop 101 belongs to agent 1
    assert.strictEqual(r.status, 403);
    const count = await db.query('SELECT COUNT(*) AS c FROM shop_visits WHERE agent_id = $1', [IDS.agent2]);
    assert.strictEqual(Number(count.rows[0].c), 0, 'nothing recorded for the other agent');
  });
});

describe('8-9. Duplicates and repeat visits', () => {
  test('8. the same request (retry) and a second tap within the window return the existing visit', async () => {
    await db.query("DELETE FROM shop_visits WHERE status IN ('verified', 'flagged')");
    const key = `dup-${Date.now()}`;
    const a = await verify(T.agent1, { idempotencyKey: key });
    const b = await verify(T.agent1, { idempotencyKey: key });
    const c = await verify(T.agent1); // new key, same shop, inside 30 minutes
    assert.strictEqual(a.json.duplicate, false);
    assert.strictEqual(b.json.duplicate, true);
    assert.strictEqual(c.json.duplicate, true);
    assert.strictEqual(b.json.visit.id, a.json.visit.id);
    assert.strictEqual(c.json.visit.id, a.json.visit.id);
    const n = await db.query("SELECT COUNT(*) AS c FROM shop_visits WHERE agent_id = $1 AND status = 'verified'", [IDS.agent1]);
    assert.strictEqual(Number(n.rows[0].c), 1);
  });

  test('8b. simultaneous submissions record one visit', async () => {
    await db.query("DELETE FROM shop_visits WHERE status IN ('verified', 'flagged')");
    const results = await Promise.all(Array.from({ length: 6 }, () => verify(T.agent1)));
    assert.ok(results.every((r) => r.status === 200));
    const n = await db.query("SELECT COUNT(*) AS c FROM shop_visits WHERE agent_id = $1 AND status = 'verified'", [IDS.agent1]);
    assert.strictEqual(Number(n.rows[0].c), 1);
  });

  test('9. visits on different days and later visits the same day are recorded separately', async () => {
    await db.query(`INSERT INTO shop_visits (id, shop_id, agent_id, status, visit_date, visited_at, latitude, longitude, gps_accuracy_m, distance_m, created_at)
      VALUES ('old-visit-1', 101, ${IDS.agent1}, 'verified', '2026-11-01', '2026-11-01T05:00:00.000Z', 10.6583, 77.0082, 10, 5, '2026-11-01T05:00:00.000Z')`);
    // A legitimate later visit the same day: shrink the window for the test
    assert.strictEqual((await setSettings({ visitDuplicateWindowMinutes: 0 })).status, 200);
    const later = await verify(T.agent1);
    assert.strictEqual(later.json.duplicate, false, 'a new visit was recorded');
    await setSettings({ visitDuplicateWindowMinutes: 30 });
    const rows = await db.query("SELECT visit_date FROM shop_visits WHERE agent_id = $1 AND shop_id = 101 AND status = 'verified'", [IDS.agent1]);
    assert.ok(rows.rows.length >= 3, 'history kept: old day + today x2');
    assert.ok(rows.rows.some((r) => r.visit_date === '2026-11-01'), 'previous day untouched');
  });
});

describe('Flagged visits and review', () => {
  let flaggedId;

  test('a suspected mock location is recorded as flagged, not verified', async () => {
    await db.query("DELETE FROM shop_visits WHERE status IN ('verified', 'flagged')");
    const r = await verify(T.agent1, { mockLocation: 'yes' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.result, 'flagged');
    assert.strictEqual(r.json.verified, false);
    assert.ok(r.json.visit.riskFlags.includes('mock_location_detected'));
    flaggedId = r.json.visit.id;
  });

  test('flagged visits do not count as verified in the summary until approved', async () => {
    const s = await api('/api/visits/summary', { token: T.manager });
    const a1 = s.json.agents.find((a) => a.agentId === IDS.agent1);
    assert.strictEqual(a1.verifiedVisits, 0);
    assert.strictEqual(a1.flaggedPendingReview, 1);
    assert.strictEqual(a1.suspicious, true);
  });

  test('another manager cannot review it; rejection needs a reason; approval is audited', async () => {
    assert.strictEqual((await api(`/api/visits/${flaggedId}/review`, { token: T.other, method: 'POST', body: { decision: 'approve' } })).status, 403);
    assert.strictEqual((await api(`/api/visits/${flaggedId}/review`, { token: T.agent1, method: 'POST', body: { decision: 'approve' } })).status, 403);
    assert.strictEqual((await api(`/api/visits/${flaggedId}/review`, { token: T.manager, method: 'POST', body: { decision: 'reject' } })).status, 400);
    const ok = await api(`/api/visits/${flaggedId}/review`, { token: T.manager, method: 'POST', body: { decision: 'approve', comment: 'Checked with shop owner' } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.visit.status, 'verified');
    assert.strictEqual(ok.json.visit.reviewDecision, 'approved');
    assert.strictEqual(ok.json.visit.reviewedBy, IDS.manager);
    const again = await api(`/api/visits/${flaggedId}/review`, { token: T.admin, method: 'POST', body: { decision: 'reject', comment: 'late' } });
    assert.strictEqual(again.status, 409, 'cannot be reviewed twice');
    const audit = await db.query("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'VISIT_REVIEW' AND target_id = $1", [flaggedId]);
    assert.strictEqual(Number(audit.rows[0].c), 1);
    const s = await api('/api/visits/summary', { token: T.manager });
    assert.strictEqual(s.json.agents.find((a) => a.agentId === IDS.agent1).verifiedVisits, 1, 'counts after approval');
  });

  test('implausible travel between shops is flagged', async () => {
    await setSettings({ visitDuplicateWindowMinutes: 0 });
    const r = await verify(T.agent1, { shopId: 151, latitude: 8.7643, longitude: 78.1348 });
    await setSettings({ visitDuplicateWindowMinutes: 30 });
    assert.strictEqual(r.json.result, 'flagged');
    assert.ok(r.json.visit.riskFlags.includes('implausible_travel_speed'));
  });

  test('failed and flagged attempts are kept for investigation', async () => {
    const r = await api('/api/visits?status=failed', { token: T.admin });
    assert.ok(r.json.visits.length >= 1);
    assert.ok(r.json.visits.every((v) => ['too_far', 'poor_accuracy', 'location_not_registered'].includes(v.status)));
  });
});

describe('10. Manager data isolation', () => {
  test("a manager sees only their team's visits and cannot query another team's agent", async () => {
    const mine = await api('/api/visits', { token: T.manager });
    assert.strictEqual(mine.status, 200);
    assert.ok(mine.json.visits.length > 0);
    const other = await api('/api/visits', { token: T.other });
    assert.ok(other.json.visits.every((v) => v.agentId === 3), 'other manager sees only agent 3');
    assert.ok(!other.json.visits.some((v) => v.agentId === IDS.agent1));
    assert.strictEqual((await api(`/api/visits?agentId=${IDS.agent1}`, { token: T.other })).status, 403);
    const sum = await api('/api/visits/summary', { token: T.other });
    assert.deepStrictEqual(sum.json.agents.map((a) => a.agentId), [3]);
  });

  test('an agent sees only their own visits; delivery agents see none', async () => {
    const r = await api('/api/visits', { token: T.agent2 });
    assert.ok(r.json.visits.every((v) => v.agentId === IDS.agent2));
    assert.strictEqual((await api('/api/visits', { token: T.delivery })).status, 403);
  });
});

describe('My shops list', () => {
  test('shows only assigned shops, with status, coordinates and filters', async () => {
    const all = await api('/api/visits/my-shops', { token: T.agent1 });
    assert.strictEqual(all.status, 200);
    const ids = all.json.shops.map((s) => s.shopId);
    assert.ok(ids.includes(101) && ids.includes(150));
    assert.ok(!ids.includes(103), "other agents' shops are excluded");
    const s101 = all.json.shops.find((s) => s.shopId === 101);
    assert.strictEqual(s101.visitStatus, 'visited');
    assert.ok(s101.lastVisitAt);
    const s150 = all.json.shops.find((s) => s.shopId === 150);
    assert.strictEqual(s150.locationRegistered, false);
    assert.strictEqual(s150.latitude, null);
    const visited = await api('/api/visits/my-shops?filter=visited_today', { token: T.agent1 });
    assert.ok(visited.json.shops.every((s) => s.visitStatus === 'visited'));
    const pending = await api('/api/visits/my-shops?filter=pending', { token: T.agent1 });
    assert.ok(pending.json.shops.every((s) => s.visitStatus === 'pending' && s.locationRegistered));
    const notVisited = await api('/api/visits/my-shops?filter=not_visited_today', { token: T.agent1 });
    assert.ok(notVisited.json.shops.some((s) => s.shopId === 150));
  });
});

describe('Shop coordinates', () => {
  test('agents cannot change coordinates; other teams cannot; invalid values and missing reasons are refused', async () => {
    const body = { latitude: 10.66, longitude: 77.01, reason: 'Surveyed' };
    assert.strictEqual((await api('/api/shops/150/location', { token: T.agent1, method: 'PUT', body })).status, 403);
    assert.strictEqual((await api('/api/shops/150/location', { token: T.other, method: 'PUT', body })).status, 403);
    assert.strictEqual((await api('/api/shops/150/location', { token: T.manager, method: 'PUT', body: { ...body, latitude: 51.5, longitude: -0.1 } })).status, 400);
    assert.strictEqual((await api('/api/shops/150/location', { token: T.manager, method: 'PUT', body: { ...body, reason: '' } })).status, 400);
  });

  test('a team manager sets the location; history records who, when, old and new; audit written', async () => {
    const r = await api('/api/shops/150/location', { token: T.manager, method: 'PUT', body: { latitude: 10.661234, longitude: 77.012345, reason: 'Visited and pinned' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.changed, true);
    const h = await api('/api/shops/150/location-history', { token: T.admin });
    const last = h.json.history[0];
    assert.strictEqual(last.oldLatitude, 0);
    assert.strictEqual(last.newLatitude, 10.661234);
    assert.strictEqual(last.changedBy, IDS.manager);
    assert.ok(last.changedAt && last.reason === 'Visited and pinned');
    const audit = await db.query("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'SHOP_LOCATION_UPDATE' AND target_id = '150'");
    assert.ok(Number(audit.rows[0].c) >= 1);
    const v = await verify(T.agent1, { shopId: 150, latitude: 10.66125, longitude: 77.01235 });
    // The shop is now verifiable. (The previous accepted visit was in Thoothukudi seconds ago, so the
    // server also, correctly, flags implausible travel; the location check itself passes.)
    assert.ok(['verified', 'flagged'].includes(v.json.result), v.json.result);
    assert.ok(v.json.visit.distanceM < 5);
    assert.ok(v.json.visit.riskFlags.every((f) => f === 'implausible_travel_speed'));
  });

  test('verifying a visit never changes the shop coordinates', async () => {
    const before = await db.query('SELECT latitude, longitude FROM shops WHERE shop_id = 101');
    await verify(T.agent1, FAR);
    const after = await db.query('SELECT latitude, longitude FROM shops WHERE shop_id = 101');
    assert.deepStrictEqual(after.rows, before.rows);
  });

  test('missing-location list is scoped to the caller', async () => {
    const r = await api('/api/visits/shop-locations?filter=all', { token: T.other });
    assert.ok(r.json.shops.every((s) => s.assignedAgentId === 3));
  });
});

describe('Settings', () => {
  test('admins can change radius and accuracy within limits; others cannot', async () => {
    assert.strictEqual((await setSettings({ visitGeofenceRadiusM: 5 })).status, 400);
    assert.strictEqual((await setSettings({ visitMaxGpsAccuracyM: 500 })).status, 400);
    assert.strictEqual((await api('/api/admin/settings', { token: T.manager, method: 'PUT', body: { visitGeofenceRadiusM: 300 } })).status, 403);
    assert.strictEqual((await setSettings({ visitGeofenceRadiusM: 300 })).status, 200);
    const r = await verify(T.agent1, { ...FAR, shopId: 101 });
    assert.notStrictEqual(r.json.result, 'too_far', '222 m passes with a 300 m radius');
    await setSettings({ visitGeofenceRadiusM: 100 });
    const s = await api('/api/visits/settings', { token: T.agent1 });
    assert.strictEqual(s.json.settings.visitGeofenceRadiusM, 100);
  });
});

describe('Migration 007', () => {
  test('tables exist, recorded in schema_migrations, and visit pages were added to stored roles', async () => {
    const m = await db.query("SELECT version FROM schema_migrations WHERE version IN ('007_shop_visits', '007_shop_visits_permissions')");
    assert.strictEqual(m.rowCount, 2);
    const fsa = await db.query("SELECT pages_json FROM role_permissions WHERE role = 'Field Sales Agent'");
    assert.ok(JSON.parse(fsa.rows[0].pages_json).includes('visits'));
    const mgr = await db.query("SELECT pages_json FROM role_permissions WHERE role = 'Sales Manager'");
    assert.ok(JSON.parse(mgr.rows[0].pages_json).includes('field-visits'));
  });
});
