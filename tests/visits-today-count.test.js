/**
 * "Today's Visits" on the Field Sales Agent Visits screen: GET /api/visits/my-shops returns
 * counts.verifiedVisitsToday = this agent's `verified` visit records dated today (IST). It must not
 * count other agents, other days, failed or flagged attempts, or assigned shops.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { tokenFor, api, initTestDb, IDS } from './helpers/session.mjs';

const istDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86400000));

let db;
const T = {};
const OWN_SHOP = 176;
const OTHER_SHOP = 177;
const inserted = [];

async function addVisit(agentId, shopId, status, date) {
  const id = `count-test-${crypto.randomUUID()}`;
  const at = new Date().toISOString();
  await db.query(
    `INSERT INTO shop_visits (id, shop_id, agent_id, status, visit_date, visited_at, mock_location, risk_flags, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'no', '[]', $7, $8)`,
    [id, shopId, agentId, status, date, at, id, at]
  );
  inserted.push(id);
}

describe("Field Sales Agent: today's visit count", () => {
  let agent1Shop;
  let otherShop;

  before(async () => {
    db = await initTestDb();
    T.agent1 = await tokenFor(IDS.agent1);
    T.agent2 = await tokenFor(IDS.agent2);
    // One test-only shop per agent (removed afterwards)
    for (const [shopId, agentId] of [[OWN_SHOP, IDS.agent1], [OTHER_SHOP, IDS.agent2]]) {
      await db.query(`INSERT INTO shops (shop_id, cluster_id, shop_name, shop_category, owner_name, contact1, contact2, latitude, longitude, address, pincode,
        payment_mode, created_by, assigned_agent_id, photo, active, created_on, survey_json)
        VALUES ($1, 1, 'Count Test Shop', 'Retail', 'Owner', '9800000177', '', 10.66, 77.01, 'Test', '642001', 0, $2, $2, 'no_image.jpg', 1, '2026-04-01 10:00:00', '[]')
        ON CONFLICT (shop_id) DO NOTHING`, [shopId, agentId]);
    }
    agent1Shop = OWN_SHOP;
    otherShop = OTHER_SHOP;
  });

  after(async () => {
    for (const id of inserted) await db.query('DELETE FROM shop_visits WHERE id = $1', [id]);
    for (const id of [OWN_SHOP, OTHER_SHOP]) await db.query('DELETE FROM shops WHERE shop_id = $1', [id]);
  });

  test('counts only this agent\'s verified visits dated today, including repeat visits and reassigned shops', async () => {
    const before = await api('/api/visits/my-shops', { token: T.agent1 });
    assert.strictEqual(before.status, 200);
    const base = before.json.counts.verifiedVisitsToday;
    const baseFlagged = before.json.counts.flaggedVisitsToday;
    assert.strictEqual(typeof base, 'number');

    const today = istDate(0);
    await addVisit(IDS.agent1, agent1Shop, 'verified', today);
    await addVisit(IDS.agent1, agent1Shop, 'verified', today); // a later visit the same day is a separate visit
    await addVisit(IDS.agent1, otherShop, 'verified', today); // shop no longer assigned to this agent
    await addVisit(IDS.agent1, agent1Shop, 'flagged', today);
    for (const s of ['rejected', 'too_far', 'poor_accuracy', 'location_not_registered']) await addVisit(IDS.agent1, agent1Shop, s, today);
    await addVisit(IDS.agent1, agent1Shop, 'verified', istDate(-1));
    await addVisit(IDS.agent1, agent1Shop, 'verified', istDate(1));
    await addVisit(IDS.agent2, otherShop, 'verified', today);

    const after1 = await api('/api/visits/my-shops', { token: T.agent1 });
    assert.strictEqual(after1.json.counts.verifiedVisitsToday, base + 3);
    assert.strictEqual(after1.json.counts.flaggedVisitsToday, baseFlagged + 1);
    assert.strictEqual(after1.json.date, today);
  });

  test('is the same whatever list filter is applied, and is not the number of assigned shops', async () => {
    const all = await api('/api/visits/my-shops?filter=all', { token: T.agent1 });
    for (const f of ['pending', 'visited_today', 'not_visited_today']) {
      const r = await api(`/api/visits/my-shops?filter=${f}`, { token: T.agent1 });
      assert.strictEqual(r.json.counts.verifiedVisitsToday, all.json.counts.verifiedVisitsToday, f);
    }
    const repeatVisits = all.json.counts.verifiedVisitsToday - all.json.counts.visitedToday;
    assert.ok(repeatVisits >= 1, 'repeat visits to one shop are counted as visits, not collapsed into shops');
  });

  test("another agent's count includes only their own visits", async () => {
    const r = await api('/api/visits/my-shops', { token: T.agent2 });
    assert.strictEqual(r.status, 200);
    const own = await db.query(`SELECT COUNT(*) AS n FROM shop_visits WHERE agent_id = $1 AND status = 'verified' AND visit_date = $2`, [IDS.agent2, istDate(0)]);
    assert.strictEqual(r.json.counts.verifiedVisitsToday, Number(own.rows[0].n));
  });
});
