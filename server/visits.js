/**
 * GPS-verified shop visits (Migration 007).
 *
 * All verification happens here on the server: the client only sends a fresh device reading.
 * Distance, accuracy checks, geofence decision, timestamps and risk flags are computed server-side.
 */
import crypto from 'crypto';
import {
  haversineMeters,
  isValidCoordinate,
  isRegisteredShopLocation,
  getVisitSettings,
  evaluateVisit
} from './geo.js';

const COUNTED_STATUSES = ['verified']; // flagged visits count only after approval (status becomes 'verified')
const ACCEPTED_STATUSES = ['verified', 'flagged']; // a visit was recorded (may still need review)

export const VISIT_MESSAGES = Object.freeze({
  verified: 'Visit Verified Successfully',
  flagged: 'Visit recorded and sent for review. Your manager will confirm it.',
  too_far: 'You are too far from this shop. Please reach the shop to mark your visit.',
  poor_accuracy: 'GPS accuracy is insufficient. Please move to an open area and try again.',
  location_not_registered: 'Shop location not registered. Ask your manager to set this shop\'s location before visits can be verified.'
});

function mapVisitRow(r, { shopsById, usersById } = {}) {
  let flags = [];
  try { flags = JSON.parse(r.risk_flags || '[]'); } catch {}
  const shop = shopsById?.get(Number(r.shop_id));
  const agent = usersById?.get(Number(r.agent_id));
  return {
    id: r.id,
    shopId: Number(r.shop_id),
    shopName: shop?.shopName || `Shop #${r.shop_id}`,
    agentId: Number(r.agent_id),
    agentName: agent?.name || `Agent #${r.agent_id}`,
    status: r.status,
    visitDate: r.visit_date,
    visitedAt: r.visited_at,
    latitude: r.latitude !== null && r.latitude !== undefined ? Number(r.latitude) : null,
    longitude: r.longitude !== null && r.longitude !== undefined ? Number(r.longitude) : null,
    gpsAccuracyM: r.gps_accuracy_m !== null && r.gps_accuracy_m !== undefined ? Number(r.gps_accuracy_m) : null,
    distanceM: r.distance_m !== null && r.distance_m !== undefined ? Number(r.distance_m) : null,
    shopLatitude: r.shop_latitude !== null && r.shop_latitude !== undefined ? Number(r.shop_latitude) : null,
    shopLongitude: r.shop_longitude !== null && r.shop_longitude !== undefined ? Number(r.shop_longitude) : null,
    geofenceRadiusM: r.geofence_radius_m !== null && r.geofence_radius_m !== undefined ? Number(r.geofence_radius_m) : null,
    maxAccuracyM: r.max_accuracy_m !== null && r.max_accuracy_m !== undefined ? Number(r.max_accuracy_m) : null,
    mockLocation: r.mock_location || 'unknown',
    riskFlags: flags,
    platform: r.platform || null,
    reviewDecision: r.review_decision || null,
    reviewedBy: r.reviewed_by !== null && r.reviewed_by !== undefined ? Number(r.reviewed_by) : null,
    reviewedByName: r.reviewed_by_name || null,
    reviewedAt: r.reviewed_at || null,
    reviewComment: r.review_comment || null
  };
}

function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * ctx: { db, getCaller, refreshStateFromDb, getShops, getUsers, getAppSettings, getAssignedAgentIds,
 *        checkActionPermission, addAuditLog, getIstDateString, addDaysToDateStr, logEvent }
 */
export function registerVisitRoutes(app, ctx) {
  const { db } = ctx;

  const roleOf = (caller) => String(caller?.role || '').toLowerCase();
  const unauthorized = (res) => res.status(401).json({ status: 401, message: 'Authentication required: valid Bearer session token must be provided.' });
  const forbidden = (res, message) => res.status(403).json({ status: 403, message });

  const lookups = () => {
    const shopsById = new Map(ctx.getShops().map((s) => [Number(s.shopid), s]));
    const usersById = new Map(ctx.getUsers().map((u) => [Number(u.id), u]));
    return { shopsById, usersById };
  };

  /** Agent ids whose visits the caller may see, or null for "all" (admin). Returns false if not permitted. */
  const visibleAgentIds = (caller) => {
    const role = roleOf(caller);
    if (role === 'admin') return null;
    if (role === 'sales manager') {
      if (!ctx.checkActionPermission(caller.role, 'view_team_visits')) return false;
      return ctx.getAssignedAgentIds(caller.id).map(Number);
    }
    if (role === 'field sales agent') return [Number(caller.id)];
    return false;
  };

  const shopAssignedAgent = (shop) => Number(shop?.assignedAgentId ?? shop?.assigned_agent_id ?? shop?.createdby ?? 0);

  // -------------------------------------------------------------------------
  // Effective settings (any signed-in user; used for on-screen hints)
  // -------------------------------------------------------------------------
  app.get('/api/visits/settings', async (req, res) => {
    if (!ctx.getCaller(req)) return unauthorized(res);
    await ctx.refreshStateFromDb();
    return res.json({ status: 200, settings: getVisitSettings(ctx.getAppSettings()) });
  });

  // -------------------------------------------------------------------------
  // Field Sales Agent: my assigned shops with today's visit state
  // -------------------------------------------------------------------------
  app.get('/api/visits/my-shops', async (req, res) => {
    const caller = ctx.getCaller(req);
    if (!caller) return unauthorized(res);
    if (roleOf(caller) !== 'field sales agent' || !ctx.checkActionPermission(caller.role, 'record_visits')) {
      return forbidden(res, 'Only Field Sales Agents can view their visit list.');
    }
    await ctx.refreshStateFromDb();
    const today = ctx.getIstDateString();
    const myShops = ctx.getShops().filter((s) => shopAssignedAgent(s) === Number(caller.id));
    const visitRows = await db.query(
      `SELECT shop_id, status, visit_date, visited_at, distance_m FROM shop_visits WHERE agent_id = $1 ORDER BY visited_at DESC`,
      [Number(caller.id)]
    );
    const byShop = new Map();
    for (const v of visitRows.rows) {
      const sid = Number(v.shop_id);
      if (!byShop.has(sid)) byShop.set(sid, []);
      byShop.get(sid).push(v);
    }
    const settings = getVisitSettings(ctx.getAppSettings());
    let list = myShops.map((s) => {
      const visits = byShop.get(Number(s.shopid)) || [];
      const todayVisits = visits.filter((v) => v.visit_date === today);
      const verifiedToday = todayVisits.filter((v) => v.status === 'verified').length;
      const flaggedToday = todayVisits.filter((v) => v.status === 'flagged').length;
      const lastVerified = visits.find((v) => v.status === 'verified');
      const lastAttempt = visits[0] || null;
      const registered = isRegisteredShopLocation(s.latitude, s.longitude);
      return {
        shopId: Number(s.shopid),
        shopShortId: `S${String(s.shopid).padStart(3, '0')}`,
        shopName: s.shopName,
        ownerName: s.ownerName || '',
        address: s.address || '',
        contact1: s.contact1 || '',
        contact2: s.contact2 || '',
        clusterId: Number(s.clusterid || 1),
        latitude: registered ? Number(s.latitude) : null,
        longitude: registered ? Number(s.longitude) : null,
        locationRegistered: registered,
        visitStatus: verifiedToday > 0 ? 'visited' : flaggedToday > 0 ? 'pending_review' : 'pending',
        visitsToday: verifiedToday,
        lastVisitAt: lastVerified ? lastVerified.visited_at : null,
        lastAttempt: lastAttempt
          ? { status: lastAttempt.status, at: lastAttempt.visited_at, distanceM: lastAttempt.distance_m !== null ? Number(lastAttempt.distance_m) : null }
          : null
      };
    });
    const counts = {
      all: list.length,
      visitedToday: list.filter((s) => s.visitStatus === 'visited').length,
      notVisitedToday: list.filter((s) => s.visitStatus !== 'visited').length,
      pending: list.filter((s) => s.visitStatus === 'pending' && s.locationRegistered).length,
      withoutLocation: list.filter((s) => !s.locationRegistered).length
    };
    const filter = String(req.query.filter || 'all');
    if (filter === 'pending') list = list.filter((s) => s.visitStatus === 'pending' && s.locationRegistered);
    else if (filter === 'visited_today') list = list.filter((s) => s.visitStatus === 'visited');
    else if (filter === 'not_visited_today') list = list.filter((s) => s.visitStatus !== 'visited');
    return res.json({ status: 200, date: today, settings, counts, shops: list });
  });

  // -------------------------------------------------------------------------
  // Field Sales Agent: verify a visit from a fresh device reading
  // -------------------------------------------------------------------------
  app.post('/api/visits/verify', async (req, res) => {
    const caller = ctx.getCaller(req);
    if (!caller) return unauthorized(res);
    if (roleOf(caller) !== 'field sales agent' || !ctx.checkActionPermission(caller.role, 'record_visits')) {
      return forbidden(res, 'Only Field Sales Agents can record shop visits.');
    }

    const body = req.body || {};
    const shopId = Number(body.shopId);
    if (!Number.isInteger(shopId) || shopId <= 0) {
      return res.status(400).json({ status: 400, result: 'invalid_request', message: 'A valid shopId is required.' });
    }
    if (!isValidCoordinate(body.latitude, body.longitude)) {
      return res.status(400).json({ status: 400, result: 'invalid_coordinates', message: 'The GPS reading is not a valid location. Please try again.' });
    }
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    const accuracyM = Number(body.accuracy);
    if (!Number.isFinite(accuracyM) || accuracyM <= 0 || accuracyM > 100000) {
      return res.status(400).json({ status: 400, result: 'invalid_accuracy', message: 'The GPS reading has no valid accuracy value. Please try again.' });
    }
    const mockLocation = ['yes', 'no'].includes(body.mockLocation) ? body.mockLocation : 'unknown';
    const platform = ['android', 'web', 'ios'].includes(body.platform) ? body.platform : 'other';
    const fixTs = Number(body.fixTimestamp);
    const clientTs = Date.parse(String(body.clientTime || ''));
    // Both values come from the device clock, so the difference is meaningful even if that clock is wrong
    const fixAgeMs = Number.isFinite(fixTs) && Number.isFinite(clientTs) ? Math.max(0, Math.round(clientTs - fixTs)) : null;
    const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotencyKey || '').trim().slice(0, 100) || null;

    await ctx.refreshStateFromDb();
    const shop = ctx.getShops().find((s) => Number(s.shopid) === shopId);
    if (!shop) return res.status(404).json({ status: 404, result: 'not_found', message: 'Shop not found.' });
    if (shopAssignedAgent(shop) !== Number(caller.id)) {
      return forbidden(res, 'This shop is not assigned to you.');
    }

    const settings = getVisitSettings(ctx.getAppSettings());
    const now = new Date();
    const nowIso = now.toISOString();
    const visitDate = ctx.getIstDateString(now);

    let outcome = null;
    let row = null;
    let duplicateOf = null;

    await db.withTransaction(async (tx) => {
      await db.lockAllocation(tx, 'shop_visits');

      if (idempotencyKey) {
        const prior = await tx.query('SELECT * FROM shop_visits WHERE idempotency_key = $1', [idempotencyKey]);
        if (prior.rowCount > 0) {
          if (Number(prior.rows[0].agent_id) !== Number(caller.id)) {
            outcome = { conflict: true };
            return;
          }
          duplicateOf = prior.rows[0];
          return;
        }
      }

      const prevRes = await tx.query(
        `SELECT latitude, longitude, visited_at FROM shop_visits
         WHERE agent_id = $1 AND status IN ('verified', 'flagged') ORDER BY visited_at DESC LIMIT 1`,
        [Number(caller.id)]
      );
      const prev = prevRes.rows[0];
      outcome = evaluateVisit({
        shopLat: shop.latitude,
        shopLng: shop.longitude,
        lat,
        lng,
        accuracyM,
        settings,
        mockLocation,
        fixAgeMs,
        previousVisit: prev ? { latitude: prev.latitude, longitude: prev.longitude, visitedAt: prev.visited_at } : null,
        nowMs: now.getTime()
      });

      // Duplicate protection: an accepted visit to this shop inside the window is returned instead of re-recorded
      if (ACCEPTED_STATUSES.includes(outcome.status) && settings.visitDuplicateWindowMinutes > 0) {
        const windowStart = new Date(now.getTime() - settings.visitDuplicateWindowMinutes * 60000).toISOString();
        const dup = await tx.query(
          `SELECT * FROM shop_visits WHERE agent_id = $1 AND shop_id = $2 AND status IN ('verified', 'flagged')
           AND visited_at >= $3 ORDER BY visited_at DESC LIMIT 1`,
          [Number(caller.id), shopId, windowStart]
        );
        if (dup.rowCount > 0) {
          duplicateOf = dup.rows[0];
          return;
        }
      }

      const registered = isRegisteredShopLocation(shop.latitude, shop.longitude);
      const id = crypto.randomUUID();
      await tx.query(
        `INSERT INTO shop_visits (id, shop_id, agent_id, status, visit_date, visited_at, latitude, longitude, gps_accuracy_m,
           distance_m, shop_latitude, shop_longitude, geofence_radius_m, max_accuracy_m, mock_location, risk_flags,
           fix_age_ms, client_time, platform, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          id, shopId, Number(caller.id), outcome.status, visitDate, nowIso, lat, lng, accuracyM,
          outcome.distanceM, registered ? Number(shop.latitude) : null, registered ? Number(shop.longitude) : null,
          settings.visitGeofenceRadiusM, settings.visitMaxGpsAccuracyM, mockLocation, JSON.stringify(outcome.flags),
          fixAgeMs, isFinite(clientTs) ? new Date(clientTs).toISOString() : null, platform, idempotencyKey, nowIso
        ]
      );
      const inserted = await tx.query('SELECT * FROM shop_visits WHERE id = $1', [id]);
      row = inserted.rows[0];
    });

    if (outcome?.conflict) {
      return res.status(409).json({ status: 409, result: 'conflict', message: 'This request key was already used. Please try again.' });
    }

    const { shopsById, usersById } = lookups();
    if (duplicateOf) {
      const visit = mapVisitRow(duplicateOf, { shopsById, usersById });
      const accepted = ACCEPTED_STATUSES.includes(visit.status);
      return res.status(accepted ? 200 : 422).json({
        status: accepted ? 200 : 422,
        result: visit.status,
        verified: visit.status === 'verified',
        duplicate: true,
        message: accepted
          ? `${VISIT_MESSAGES[visit.status]} (already recorded at this shop a moment ago)`
          : VISIT_MESSAGES[visit.status] || 'Visit not verified.',
        visit,
        radiusM: visit.geofenceRadiusM,
        maxAccuracyM: visit.maxAccuracyM
      });
    }

    const visit = mapVisitRow(row, { shopsById, usersById });
    if (ACCEPTED_STATUSES.includes(visit.status)) {
      await ctx.addAuditLog(
        req,
        visit.status === 'verified' ? 'VISIT_VERIFIED' : 'VISIT_FLAGGED',
        'ShopVisit',
        visit.id,
        `Shop #${shopId} ${visit.status} at ${visit.distanceM} m (accuracy ${accuracyM} m)${visit.riskFlags.length ? `, flags: ${visit.riskFlags.join(', ')}` : ''}`
      );
    }
    const accepted = ACCEPTED_STATUSES.includes(visit.status);
    return res.status(accepted ? 200 : 422).json({
      status: accepted ? 200 : 422,
      result: visit.status,
      verified: visit.status === 'verified',
      duplicate: false,
      message: VISIT_MESSAGES[visit.status],
      visit,
      radiusM: settings.visitGeofenceRadiusM,
      maxAccuracyM: settings.visitMaxGpsAccuracyM,
      reviewMaxAccuracyM: settings.visitReviewMaxGpsAccuracyM
    });
  });

  // -------------------------------------------------------------------------
  // Visit history (agent: own; manager: team; admin: all)
  // -------------------------------------------------------------------------
  app.get('/api/visits', async (req, res) => {
    const caller = ctx.getCaller(req);
    if (!caller) return unauthorized(res);
    const visible = visibleAgentIds(caller);
    if (visible === false) return forbidden(res, 'You do not have access to visit records.');

    const today = ctx.getIstDateString();
    const from = isDateStr(req.query.from) ? req.query.from : ctx.addDaysToDateStr(today, -6);
    const to = isDateStr(req.query.to) ? req.query.to : today;
    const where = ['visit_date >= $1', 'visit_date <= $2'];
    const params = [from, to];

    if (req.query.agentId && req.query.agentId !== 'all') {
      const aid = Number(req.query.agentId);
      if (visible !== null && !visible.includes(aid)) return forbidden(res, 'That agent is not in your team.');
      params.push(aid);
      where.push(`agent_id = $${params.length}`);
    } else if (visible !== null) {
      if (visible.length === 0) return res.json({ status: 200, from, to, visits: [] });
      where.push(`agent_id IN (${visible.map((id) => { params.push(id); return `$${params.length}`; }).join(', ')})`);
    }
    if (req.query.shopId) {
      params.push(Number(req.query.shopId));
      where.push(`shop_id = $${params.length}`);
    }
    const status = String(req.query.status || 'all');
    if (status === 'failed') where.push("status IN ('too_far', 'poor_accuracy', 'location_not_registered')");
    else if (status !== 'all' && /^[a-z_]+$/.test(status)) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500));
    await ctx.refreshStateFromDb();
    const rows = await db.query(
      `SELECT * FROM shop_visits WHERE ${where.join(' AND ')} ORDER BY visited_at DESC LIMIT ${limit}`,
      params
    );
    const { shopsById, usersById } = lookups();
    return res.json({ status: 200, from, to, visits: rows.rows.map((r) => mapVisitRow(r, { shopsById, usersById })) });
  });

  // -------------------------------------------------------------------------
  // Daily summary per agent (manager: team; admin: all agents)
  // -------------------------------------------------------------------------
  app.get('/api/visits/summary', async (req, res) => {
    const caller = ctx.getCaller(req);
    if (!caller) return unauthorized(res);
    const role = roleOf(caller);
    if (role !== 'admin' && role !== 'sales manager') return forbidden(res, 'Only managers and admins can view visit summaries.');
    const visible = visibleAgentIds(caller);
    if (visible === false) return forbidden(res, 'You do not have access to visit records.');

    await ctx.refreshStateFromDb();
    const date = isDateStr(req.query.date) ? req.query.date : ctx.getIstDateString();
    const agents = ctx.getUsers().filter(
      (u) => String(u.role || '').toLowerCase() === 'field sales agent' && (visible === null || visible.includes(Number(u.id)))
    );
    const agentIds = agents.map((a) => Number(a.id));
    let rows = [];
    if (agentIds.length) {
      const params = [date, ...agentIds];
      const res2 = await db.query(
        `SELECT agent_id, shop_id, status FROM shop_visits WHERE visit_date = $1 AND agent_id IN (${agentIds.map((_, i) => `$${i + 2}`).join(', ')})`,
        params
      );
      rows = res2.rows;
    }
    const shops = ctx.getShops();
    const summary = agents.map((a) => {
      const mine = shops.filter((s) => shopAssignedAgent(s) === Number(a.id));
      const mineRows = rows.filter((r) => Number(r.agent_id) === Number(a.id));
      const visitedShopIds = new Set(mineRows.filter((r) => COUNTED_STATUSES.includes(r.status)).map((r) => Number(r.shop_id)));
      const registered = mine.filter((s) => isRegisteredShopLocation(s.latitude, s.longitude));
      const failed = mineRows.filter((r) => ['too_far', 'poor_accuracy', 'location_not_registered'].includes(r.status)).length;
      return {
        agentId: Number(a.id),
        agentName: a.name,
        active: Number(a.active) === 1,
        assignedShops: mine.length,
        shopsWithoutLocation: mine.length - registered.length,
        verifiedVisits: mineRows.filter((r) => r.status === 'verified').length,
        shopsVisited: visitedShopIds.size,
        pendingShops: registered.filter((s) => !visitedShopIds.has(Number(s.shopid))).length,
        flaggedPendingReview: mineRows.filter((r) => r.status === 'flagged').length,
        failedAttempts: failed,
        suspicious: failed >= 3 || mineRows.some((r) => r.status === 'flagged')
      };
    });
    const totals = summary.reduce(
      (t, s) => ({
        verifiedVisits: t.verifiedVisits + s.verifiedVisits,
        shopsVisited: t.shopsVisited + s.shopsVisited,
        pendingShops: t.pendingShops + s.pendingShops,
        flaggedPendingReview: t.flaggedPendingReview + s.flaggedPendingReview,
        failedAttempts: t.failedAttempts + s.failedAttempts
      }),
      { verifiedVisits: 0, shopsVisited: 0, pendingShops: 0, flaggedPendingReview: 0, failedAttempts: 0 }
    );
    return res.json({ status: 200, date, settings: getVisitSettings(ctx.getAppSettings()), totals, agents: summary });
  });

  // -------------------------------------------------------------------------
  // Review a flagged visit (manager for own team, or admin)
  // -------------------------------------------------------------------------
  app.post('/api/visits/:id/review', async (req, res) => {
    const caller = ctx.getCaller(req);
    if (!caller) return unauthorized(res);
    const role = roleOf(caller);
    if (role !== 'admin' && !(role === 'sales manager' && ctx.checkActionPermission(caller.role, 'review_visits'))) {
      return forbidden(res, 'Only managers and admins can review visits.');
    }
    const decision = String(req.body?.decision || '').toLowerCase();
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ status: 400, message: "Decision must be 'approve' or 'reject'." });
    }
    const comment = String(req.body?.comment || '').trim().slice(0, 500);
    if (decision === 'reject' && comment.length < 3) {
      return res.status(400).json({ status: 400, message: 'Please give a short reason when rejecting a visit.' });
    }
    const id = String(req.params.id || '').slice(0, 64);
    const found = await db.query('SELECT * FROM shop_visits WHERE id = $1', [id]);
    if (found.rowCount === 0) return res.status(404).json({ status: 404, message: 'Visit not found.' });
    const visitRow = found.rows[0];
    if (role === 'sales manager' && !ctx.getAssignedAgentIds(caller.id).map(Number).includes(Number(visitRow.agent_id))) {
      return forbidden(res, 'That visit belongs to an agent outside your team.');
    }
    if (visitRow.status !== 'flagged') {
      return res.status(409).json({ status: 409, message: `This visit is '${visitRow.status}' and does not need review.` });
    }
    const newStatus = decision === 'approve' ? 'verified' : 'rejected';
    const nowIso = new Date().toISOString();
    const upd = await db.query(
      `UPDATE shop_visits SET status = $1, review_decision = $2, reviewed_by = $3, reviewed_by_name = $4, reviewed_at = $5, review_comment = $6
       WHERE id = $7 AND status = 'flagged'`,
      [newStatus, decision === 'approve' ? 'approved' : 'rejected', Number(caller.id), caller.name || `User ${caller.id}`, nowIso, comment || null, id]
    );
    if (upd.rowCount === 0) {
      return res.status(409).json({ status: 409, message: 'This visit was already reviewed.' });
    }
    await ctx.addAuditLog(req, 'VISIT_REVIEW', 'ShopVisit', id, `${decision === 'approve' ? 'Approved' : 'Rejected'} flagged visit of agent #${visitRow.agent_id} at shop #${visitRow.shop_id}${comment ? `: ${comment}` : ''}`);
    await ctx.refreshStateFromDb();
    const after = await db.query('SELECT * FROM shop_visits WHERE id = $1', [id]);
    return res.json({ status: 200, message: `Visit ${decision === 'approve' ? 'approved' : 'rejected'}.`, visit: mapVisitRow(after.rows[0], lookups()) });
  });

  // -------------------------------------------------------------------------
  // Shop coordinates: list missing, correct (with history), view history
  // -------------------------------------------------------------------------
  const canManageShopLocation = (caller, shop) => {
    const role = roleOf(caller);
    if (role === 'admin') return true;
    if (role === 'sales manager' && ctx.checkActionPermission(caller.role, 'manage_shop_locations')) {
      return ctx.getAssignedAgentIds(caller.id).map(Number).includes(shopAssignedAgent(shop));
    }
    return false;
  };

  app.get('/api/visits/shop-locations', async (req, res) => {
    const caller = ctx.getCaller(req);
    if (!caller) return unauthorized(res);
    const role = roleOf(caller);
    if (role !== 'admin' && !(role === 'sales manager' && ctx.checkActionPermission(caller.role, 'manage_shop_locations'))) {
      return forbidden(res, 'Only managers and admins can review shop locations.');
    }
    await ctx.refreshStateFromDb();
    const { usersById } = lookups();
    const list = ctx.getShops()
      .filter((s) => canManageShopLocation(caller, s))
      .map((s) => {
        const registered = isRegisteredShopLocation(s.latitude, s.longitude);
        const aid = shopAssignedAgent(s);
        return {
          shopId: Number(s.shopid),
          shopName: s.shopName,
          address: s.address || '',
          clusterId: Number(s.clusterid || 1),
          assignedAgentId: aid,
          assignedAgentName: usersById.get(aid)?.name || `Agent #${aid}`,
          latitude: Number(s.latitude || 0),
          longitude: Number(s.longitude || 0),
          locationRegistered: registered
        };
      });
    const only = String(req.query.filter || 'missing');
    const shops = only === 'all' ? list : list.filter((s) => !s.locationRegistered);
    return res.json({ status: 200, totals: { all: list.length, missing: list.filter((s) => !s.locationRegistered).length }, shops });
  });

  app.put('/api/shops/:shopId/location', async (req, res) => {
    const caller = ctx.getCaller(req);
    if (!caller) return unauthorized(res);
    await ctx.refreshStateFromDb();
    const shopId = Number(String(req.params.shopId || '').replace(/^S/i, ''));
    const shop = ctx.getShops().find((s) => Number(s.shopid) === shopId);
    if (!shop) return res.status(404).json({ status: 404, message: 'Shop not found.' });
    if (!canManageShopLocation(caller, shop)) {
      return forbidden(res, 'You are not allowed to change this shop\'s location.');
    }
    const { latitude, longitude } = req.body || {};
    if (!isRegisteredShopLocation(latitude, longitude)) {
      return res.status(400).json({ status: 400, message: 'Enter a valid location inside India (latitude 6 to 37.5, longitude 68 to 97.5).' });
    }
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (reason.length < 3) {
      return res.status(400).json({ status: 400, message: 'Please give a short reason for the location change.' });
    }
    const source = req.body?.source === 'device_gps' ? 'device_gps' : 'manual';
    const newLat = Math.round(Number(latitude) * 1e6) / 1e6;
    const newLng = Math.round(Number(longitude) * 1e6) / 1e6;
    const nowIso = new Date().toISOString();
    let changed = false;
    let oldLat = null;
    let oldLng = null;

    await db.withTransaction(async (tx) => {
      await db.lockAllocation(tx, 'shop_location');
      const cur = await tx.query('SELECT latitude, longitude FROM shops WHERE shop_id = $1', [shopId]);
      oldLat = cur.rows[0] ? Number(cur.rows[0].latitude) : null;
      oldLng = cur.rows[0] ? Number(cur.rows[0].longitude) : null;
      if (oldLat === newLat && oldLng === newLng) return;
      await tx.query(
        `INSERT INTO shop_location_history (id, shop_id, old_latitude, old_longitude, new_latitude, new_longitude, source, reason,
           changed_by, changed_by_name, changed_by_role, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [crypto.randomUUID(), shopId, oldLat, oldLng, newLat, newLng, source, reason, Number(caller.id), caller.name || `User ${caller.id}`, caller.role, nowIso]
      );
      await tx.query('UPDATE shops SET latitude = $1, longitude = $2 WHERE shop_id = $3', [newLat, newLng, shopId]);
      changed = true;
    });

    if (changed) {
      const moved = isValidCoordinate(oldLat, oldLng) ? Math.round(haversineMeters(oldLat, oldLng, newLat, newLng)) : null;
      await ctx.addAuditLog(req, 'SHOP_LOCATION_UPDATE', 'Shop', shopId, `Location of shop #${shopId} changed from ${oldLat}, ${oldLng} to ${newLat}, ${newLng}${moved !== null ? ` (${moved} m)` : ''}. Reason: ${reason}`);
      await ctx.refreshStateFromDb();
    }
    return res.json({ status: 200, changed, message: changed ? 'Shop location saved.' : 'Location unchanged.', shop: { shopId, latitude: newLat, longitude: newLng } });
  });

  app.get('/api/shops/:shopId/location-history', async (req, res) => {
    const caller = ctx.getCaller(req);
    if (!caller) return unauthorized(res);
    await ctx.refreshStateFromDb();
    const shopId = Number(String(req.params.shopId || '').replace(/^S/i, ''));
    const shop = ctx.getShops().find((s) => Number(s.shopid) === shopId);
    if (!shop) return res.status(404).json({ status: 404, message: 'Shop not found.' });
    if (!canManageShopLocation(caller, shop)) return forbidden(res, 'You are not allowed to view this shop\'s location history.');
    const rows = await db.query('SELECT * FROM shop_location_history WHERE shop_id = $1 ORDER BY changed_at DESC', [shopId]);
    return res.json({
      status: 200,
      shopId,
      history: rows.rows.map((r) => ({
        id: r.id,
        oldLatitude: r.old_latitude !== null ? Number(r.old_latitude) : null,
        oldLongitude: r.old_longitude !== null ? Number(r.old_longitude) : null,
        newLatitude: Number(r.new_latitude),
        newLongitude: Number(r.new_longitude),
        source: r.source,
        reason: r.reason,
        changedBy: Number(r.changed_by),
        changedByName: r.changed_by_name,
        changedByRole: r.changed_by_role,
        changedAt: r.changed_at
      }))
    });
  });
}
