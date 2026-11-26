import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as seedData from './data.loader.js';
import {
  db,
  runMigrationsAndSeed,
  loadDatabaseState,
  isValidIndianMobile,
  isKnownDemoPassword,
  INDIAN_MOBILE_REGEX,
  isLocalTestPostgres
} from './db.js';
import {
  wrapAsyncRoutes,
  requestIdMiddleware,
  errorMiddleware,
  installProcessHandlers,
  logEvent
} from './http-errors.js';
import { registerVisitRoutes } from './visits.js';
import { installRouteDeclarations, STAFF_ROLES, canonicalRole } from './access.js';
import { validateVisitSettingUpdates } from './geo.js';
import {
  ORDER_STATUSES,
  effectiveStatus,
  isRecognisedStatus,
  sameLifecycleState,
  checkTransition,
  conflictBody,
  updateOrderIfStatus
} from './orderStatus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment Configuration Loader (.env reader without third-party deps)
const loadEnvFile = () => {
  // Under the test runner, never read developer .env files (they may contain real database credentials).
  if (process.env.LINECART_TEST_MODE === '1') {
    console.log('[Config] Test mode: skipping .env files');
    return;
  }
  const envCandidates = [
    path.join(__dirname, '../.env'),
    path.join(__dirname, '.env'),
    path.join(process.cwd(), '.env')
  ];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      });
      console.log(`[Config] Loaded environment variables from ${envPath}`);
      break;
    }
  }
};
loadEnvFile();

const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production' ||
                     (process.env.APP_ENV || '').toLowerCase() === 'staging';
console.log(`[Security] Server running in ${isProduction ? 'PRODUCTION / STAGING (Strict Security)' : 'DEVELOPMENT / LOCAL'} mode`);

// Cryptographic Password Hashing (scrypt + 16-byte random salt + timingSafeEqual)
export const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
};

export const verifyPassword = (password, storedValue) => {
  if (!storedValue || !password) return false;
  const strVal = String(storedValue);
  const strPwd = String(password);
  if (!strVal.includes(':')) {
    return false;
  }
  const [salt, key] = strVal.split(':');
  if (!salt || !key) return false;
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(strPwd, salt, 64);
  if (keyBuffer.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
};

const hashSessionToken = (token) => {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
};

// ============================================================================
// DEFAULT ROLE PERMISSIONS & IN-MEMORY PROJECTION CACHE (BACKED BY SQL DB)
// ============================================================================

const adminConfigFilePath = path.join(__dirname, 'admin_config.json');
const shopUploadsDir = path.join(__dirname, 'uploads', 'shops');
if (!fs.existsSync(shopUploadsDir)) {
  fs.mkdirSync(shopUploadsDir, { recursive: true });
}

// Durable Photo Storage: Local disk by default, Supabase Storage when configured
const supabaseStorageUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseBucket = (process.env.SUPABASE_BUCKET || 'shop-photos').trim();
const useSupabaseStorage = Boolean(supabaseStorageUrl && supabaseServiceKey);

async function saveShopPhoto(filename, buffer, mimeType) {
  const destPath = path.join(shopUploadsDir, filename);

  // If Supabase Storage is configured, remote upload is authoritative and REQUIRED.
  // We must not silently report success if the remote upload fails.
  if (useSupabaseStorage) {
    let uploadRes;
    let errText = '';
    try {
      const uploadUrl = `${supabaseStorageUrl}/storage/v1/object/${supabaseBucket}/${filename}`;
      uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': mimeType || 'image/jpeg',
          'x-upsert': 'true'
        },
        body: buffer
      });
    } catch (err) {
      throw new Error(`Remote photo storage connection failed: ${err.message}`);
    }

    if (!uploadRes.ok) {
      try { errText = await uploadRes.text(); } catch {}
      throw new Error(`Remote photo storage rejected upload (HTTP ${uploadRes.status}): ${errText || uploadRes.statusText}`);
    }

    console.log(`[Storage] Persisted ${filename} to Supabase Storage (${supabaseBucket})`);
  }

  // Local write: acts as local cache when cloud storage is configured,
  // or primary storage for local development when cloud storage is not configured.
  try {
    fs.writeFileSync(destPath, buffer);
  } catch (err) {
    if (!useSupabaseStorage) {
      // In local development, failure to write to disk is a hard failure
      throw new Error(`Local photo storage write failed: ${err.message}`);
    } else {
      console.warn(`[Storage Warning] Failed to write local cache for ${filename}:`, err.message);
    }
  }
}

async function getShopPhoto(filename) {
  const destPath = path.join(shopUploadsDir, filename);
  if (fs.existsSync(destPath)) {
    return { buffer: fs.readFileSync(destPath), local: true };
  }

  // If not on local disk (e.g. after container restart), fetch from Supabase Storage
  if (useSupabaseStorage) {
    try {
      // Supabase Storage REST API download: GET /storage/v1/object/{bucket}/{filename}
      // Service role key bypasses Row-Level Security (RLS) for private buckets
      const downloadUrl = `${supabaseStorageUrl}/storage/v1/object/${supabaseBucket}/${filename}`;
      const res = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`
        }
      });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        // Cache to local disk for fast subsequent reads
        try { fs.writeFileSync(destPath, buf); } catch {}
        return { buffer: buf, local: false };
      } else if (res.status !== 404) {
        const errText = await res.text();
        console.warn(`[Storage Warning] Supabase Storage download error for ${filename} (${res.status}):`, errText);
      }
    } catch (err) {
      console.warn(`[Storage Warning] Failed to retrieve ${filename} from Supabase Storage:`, err.message);
    }
  }

  return null;
}

const DEFAULT_ROLE_PERMISSIONS = {
  Admin: {
    pages: ['admin-dashboard', 'admin-users', 'admin-roles', 'admin-assignments', 'admin-targets', 'admin-orders', 'admin-reports', 'admin-shops', 'admin-audit', 'admin-settings', 'items'],
    actions: ['view_all_reports', 'export_reports', 'export_png', 'manage_users', 'manage_roles', 'manage_assignments', 'manage_targets', 'manage_settings', 'create_order', 'view_orders', 'view_shops', 'manage_items', 'manage_daily_prices', 'view_items']
  },
  'Sales Manager': {
    pages: ['reports', 'orders', 'map', 'team', 'customers', 'items', 'field-visits'],
    actions: ['view_team_reports', 'export_reports', 'export_png', 'view_team_orders', 'view_cluster_shops', 'view_team', 'view_items', 'update_daily_prices', 'view_team_visits', 'review_visits', 'manage_shop_locations']
  },
  'Field Sales Agent': {
    pages: ['overview', 'orders', 'reports', 'customers', 'summary', 'visits'],
    actions: ['view_agent_reports', 'create_order', 'view_assigned_shops', 'add_customer', 'view_summary', 'record_visits']
  },
  'Delivery Agent': {
    pages: ['delivery'],
    actions: ['view_assigned_deliveries', 'update_delivery_status']
  }
};

const clusters = seedData.clusters;
const defaultOrderItems = seedData.defaultOrderItems;

let salesPersons = [];
let shops = [];
let submittedOrders = [];
let managerAssignments = {};
let salesTargets = [];
let orderItemsCatalog = [];
let clusterItemPrices = [];
let priceHistoryList = [];
let priceRequestsList = [];
let rolePermissions = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));
let appSettings = {
  organizationName: 'LineCart Wholesale Logistics',
  currencySymbol: '₹',
  defaultTargetPeriod: new Date().toISOString().slice(0, 7),
  maintenanceMode: false
};
let auditLogs = [];
let invalidPhoneAccounts = [];

async function refreshStateFromDb() {
  const state = await loadDatabaseState(DEFAULT_ROLE_PERMISSIONS);
  salesPersons = state.users;
  shops = state.shops;
  submittedOrders = state.orders;
  managerAssignments = state.managerAssignments;
  salesTargets = state.salesTargets;
  orderItemsCatalog = state.items || [];
  clusterItemPrices = state.clusterItemPrices || [];
  priceHistoryList = state.priceHistory || [];
  priceRequestsList = state.priceRequests || [];
  rolePermissions = state.rolePermissions;
  appSettings = state.appSettings;
  auditLogs = state.auditLogs;
}

// ============================================================================
// SESSION MANAGEMENT & RATE LIMITING (PERSISTED IN SQL DATABASE)
// ============================================================================

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000); // 12 hours default
const LOGIN_RATE_WINDOW_MS = Number(process.env.LOGIN_RATE_WINDOW_MS || 15 * 60 * 1000); // 15 minutes
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_MAX_IP_ATTEMPTS = Number(process.env.LOGIN_MAX_IP_ATTEMPTS || 25);

async function createSession(user) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const nowMs = Date.now();
  const expiresAtMs = nowMs + SESSION_TTL_MS;

  await db.query(
    `INSERT INTO sessions (token_hash, user_id, role, is_dev_admin, created_at, last_seen, expires_at, revoked_at)
     VALUES ($1, $2, $3, 0, $4, $5, $6, NULL)`,
    [tokenHash, Number(user.id), String(user.role), nowMs, nowMs, expiresAtMs]
  );
  return rawToken;
}

async function revokeSessionByToken(rawToken) {
  if (!rawToken) return false;
  const tokenHash = hashSessionToken(rawToken);
  const res = await db.query(
    'UPDATE sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL',
    [Date.now(), tokenHash]
  );
  return res.rowCount > 0;
}

async function revokeAllUserSessions(userId) {
  await db.query(
    'UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL',
    [Date.now(), Number(userId)]
  );
}

async function revokeOtherUserSessions(userId, keepRawToken) {
  const res = await db.query(
    'UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL AND token_hash <> $3',
    [Date.now(), Number(userId), keepRawToken ? hashSessionToken(keepRawToken) : '']
  );
  return res.rowCount || 0;
}

/**
 * Reads the session credential from the request headers (T0.8).
 * Accepted: Authorization: Bearer <token>, X-Session-Token: <token>, X-Token: <token>, in any
 * combination as long as every one present carries the same token (the apps send the first two).
 * Returns { token, failure } where failure is null, 'AUTH_REQUIRED' (nothing sent),
 * 'AUTH_MALFORMED' (unknown scheme, "Bearer" without a token, a list of values) or
 * 'AUTH_CONFLICT' (headers carry different tokens). Cookies are never read.
 */
function readCredentialHeaders(req) {
  const headers = (req && req.headers) || {};
  const asText = (v) => (Array.isArray(v) ? v.join(',') : String(v)).trim();
  const tokens = [];
  if (headers.authorization !== undefined) {
    const value = asText(headers.authorization);
    if (value) {
      const m = /^Bearer[ \t]+([^\s,]+)$/i.exec(value);
      if (!m) return { token: null, failure: 'AUTH_MALFORMED' };
      tokens.push(m[1]);
    }
  }
  for (const name of ['x-session-token', 'x-token']) {
    if (headers[name] === undefined) continue;
    const value = asText(headers[name]);
    if (!value) continue;
    if (/[\s,]/.test(value)) return { token: null, failure: 'AUTH_MALFORMED' };
    tokens.push(value);
  }
  if (tokens.length === 0) return { token: null, failure: 'AUTH_REQUIRED' };
  if (new Set(tokens).size > 1) return { token: null, failure: 'AUTH_CONFLICT' };
  return { token: tokens[0], failure: null };
}

function extractBearerToken(req) {
  return readCredentialHeaders(req).token;
}

/**
 * Authoritative server-side caller resolution.
 * Strictly validates the Bearer / session token against the database.
 * NEVER trusts X-User-Id, userid, callerId, spersonId, or managerId from headers, query, or body.
 */
async function getCallerAsync(req) {
  if (!req) return null;
  if (req._resolvedCaller !== undefined) {
    return req._resolvedCaller;
  }

  const credential = readCredentialHeaders(req);
  const rawToken = credential.token;
  if (!rawToken) {
    req._authFailure = credential.failure;
    req._resolvedCaller = null;
    return null;
  }
  // Until a session is confirmed below, any refusal is an invalid session
  req._authFailure = 'SESSION_INVALID';

  const tokenHash = hashSessionToken(rawToken);
  const sessRes = await db.query(
    `SELECT s.token_hash, s.user_id, s.expires_at, s.revoked_at,
            u.id, u.name, u.role, u.phone, u.phone_valid, u.must_change_password, u.cluster_id, u.active
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash]
  );

  if (sessRes.rowCount === 0) {
    req._resolvedCaller = null;
    return null;
  }

  const row = sessRes.rows[0];
  if (row.revoked_at !== null && row.revoked_at !== undefined) {
    req._resolvedCaller = null;
    return null;
  }

  const nowMs = Date.now();
  if (Number(row.expires_at) <= nowMs) {
    await db.query('UPDATE sessions SET revoked_at = $1 WHERE token_hash = $2', [nowMs, tokenHash]);
    req._authFailure = 'SESSION_EXPIRED';
    req._resolvedCaller = null;
    return null;
  }

  if (Number(row.active) === 0 || Number(row.phone_valid) === 0) {
    req._resolvedCaller = null;
    return null;
  }

  const caller = {
    id: Number(row.id),
    name: row.name,
    role: row.role,
    phone: row.phone,
    phoneValid: Number(row.phone_valid) === 1,
    mustChangePassword: Number(row.must_change_password) === 1,
    clusterid: Number(row.cluster_id || 1),
    active: Number(row.active),
    sessionToken: rawToken
  };

  req._authFailure = null;
  req._resolvedCaller = caller;
  return caller;
}

function getCaller(req) {
  return req ? (req._resolvedCaller || null) : null;
}

async function isLoginRateLimited(ipAddress, phoneKey) {
  try {
    const cutoffMs = Date.now() - LOGIN_RATE_WINDOW_MS;
    const phoneRes = await db.query(
      `SELECT COUNT(*) AS cnt
       FROM login_attempts
       WHERE attempted_at >= $1 AND identifier = $2 AND success = 0`,
      [cutoffMs, String(phoneKey || 'unknown')]
    );
    if (Number(phoneRes.rows[0]?.cnt || 0) >= LOGIN_MAX_ATTEMPTS) {
      return true;
    }

    const ipRes = await db.query(
      `SELECT COUNT(*) AS cnt
       FROM login_attempts
       WHERE attempted_at >= $1 AND ip_address = $2 AND success = 0`,
      [cutoffMs, String(ipAddress || 'unknown')]
    );
    return Number(ipRes.rows[0]?.cnt || 0) >= LOGIN_MAX_IP_ATTEMPTS;
  } catch (err) {
    console.warn('[RateLimit Check Error]', err?.message || err);
    return false;
  }
}

async function recordFailedLoginAttempt(ipAddress, phoneKey) {
  try {
    if (db.mode === 'postgres') {
      // Serialised so concurrent failed logins cannot collide on the same id and go uncounted
      await db.withTransaction(async (tx) => {
        await db.lockAllocation(tx, 'login_attempts');
        await tx.query(
          `INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success)
           VALUES (COALESCE((SELECT MAX(id) FROM login_attempts), 0) + 1, $1, $2, $3, 0)`,
          [String(phoneKey || 'unknown').slice(0, 32), String(ipAddress || 'unknown'), Date.now()]
        );
      });
    } else {
      await db.query(
        'INSERT INTO login_attempts (identifier, ip_address, attempted_at, success) VALUES ($1, $2, $3, 0)',
        [String(phoneKey || 'unknown').slice(0, 32), String(ipAddress || 'unknown'), Date.now()]
      );
    }
  } catch (err) {
    console.warn('[RateLimit Record Error]', err?.message || err);
  }
}

async function clearLoginAttempts(phoneKey) {
  if (!phoneKey) return;
  try {
    await db.query('DELETE FROM login_attempts WHERE identifier = $1', [String(phoneKey)]);
  } catch (err) {
    console.warn('[RateLimit Clear Error]', err?.message || err);
  }
}

// Audit Trail Logger (Persisted to SQL Database)
async function addAuditLog(req, action, targetType, targetId, details) {
  const caller = req ? getCaller(req) : null;
  const adminUser = salesPersons.find((s) => (s.role || '').toLowerCase() === 'admin');
  const entry = {
    id: `AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date().toISOString(),
    adminId: caller ? Number(caller.id) : (adminUser ? Number(adminUser.id) : 0),
    adminName: caller ? caller.name : (adminUser ? adminUser.name : 'System Security'),
    action: String(action),
    targetType: String(targetType || 'System'),
    targetId: String(targetId || ''),
    details: typeof details === 'object' ? JSON.stringify(details) : String(details || '')
  };

  await db.query(
    `INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [entry.id, entry.timestamp, entry.adminId, entry.adminName, entry.action, entry.targetType, entry.targetId, entry.details]
  );

  auditLogs.unshift(entry);
  if (auditLogs.length > 500) auditLogs.length = 500;
  return entry;
}

// Check if role has action permission
const checkActionPermission = (role, actionName) => {
  if (role === 'Admin') return true;
  const perms = rolePermissions[role];
  if (!perms || !Array.isArray(perms.actions)) return false;
  return perms.actions.includes(actionName);
};

const getAssignedAgentIds = (managerId) => {
  const mId = Number(managerId);
  return managerAssignments[mId] || [];
};

// Authentication & Role Guard Middlewares
const requireAuth = (req, res, next) => {
  const caller = getCaller(req);
  if (!caller) {
    return res.status(401).json({
      status: 401,
      message: 'Authentication required: valid Bearer session token must be provided.'
    });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  const caller = getCaller(req);
  if (!caller) {
    return res.status(401).json({
      status: 401,
      message: 'Authentication required: valid Bearer session token must be provided.'
    });
  }
  if ((caller.role || '').toLowerCase() !== 'admin') {
    return res.status(403).json({
      status: 403,
      message: 'Access Denied: Administrator role required.'
    });
  }
  next();
};

// Strict Backend Authorization Guard for Sales Managers & Admins
const authorizeManagerAccess = (req, res, requestedManagerId) => {
  const caller = getCaller(req);
  if (!caller) {
    res.status(401).json({
      status: 401,
      message: 'Authentication required: valid Bearer session token must be provided.'
    });
    return { authorized: false };
  }

  const callerRole = (caller.role || '').toLowerCase();
  if (callerRole === 'admin') {
    let effectiveId = requestedManagerId && requestedManagerId !== 'all'
      ? Number(requestedManagerId)
      : null;
    if (!effectiveId) {
      const firstManager = salesPersons.find((s) => (s.role || '').toLowerCase() === 'sales manager');
      effectiveId = firstManager ? Number(firstManager.id) : 100;
    }
    return { authorized: true, caller, effectiveManagerId: effectiveId };
  }

  if (callerRole === 'sales manager') {
    // Sales Managers always access their own assigned team, irrespective of requestedManagerId
    return { authorized: true, caller, effectiveManagerId: Number(caller.id) };
  }

  res.status(403).json({
    status: 403,
    message: `Access Denied: Role '${caller.role}' cannot access Sales Manager resources.`
  });
  return { authorized: false };
};

/**
 * Determine authorized wholesale cluster IDs for a given caller.
 * - Admin: all clusters.
 * - Sales Manager: their cluster plus clusters of their assigned field agents and their shops.
 * - Field Sales Agent: strictly clusters containing shops assigned to them (fallback to user cluster_id if none).
 */
function getAuthorizedClusterIds(caller) {
  if (!caller) return [];
  const callerRole = (caller.role || '').toLowerCase();
  if (callerRole === 'admin') {
    return clusters.map((c) => Number(c.clusterId));
  }
  if (callerRole === 'sales manager') {
    const assignedAgentIds = getAssignedAgentIds(caller.id);
    const assignedClusters = salesPersons
      .filter((s) => assignedAgentIds.includes(Number(s.id)))
      .map((s) => Number(s.clusterid || 1));
    const teamShopClusters = shops
      .filter((sh) => assignedAgentIds.includes(Number(sh.assignedAgentId || sh.assigned_agent_id || 0)))
      .map((sh) => Number(sh.clusterid || 1));
    const ownCluster = Number(caller.clusterid || 1);
    return Array.from(new Set([ownCluster, ...assignedClusters, ...teamShopClusters]));
  }
  if (callerRole === 'field sales agent') {
    const agentShops = shops.filter((sh) => {
      const aid = sh.assignedAgentId !== undefined && sh.assignedAgentId !== null
        ? Number(sh.assignedAgentId)
        : (sh.assigned_agent_id !== undefined && sh.assigned_agent_id !== null ? Number(sh.assigned_agent_id) : null);
      return aid !== null && aid > 0 && aid === Number(caller.id);
    });
    if (agentShops.length > 0) {
      return Array.from(new Set(agentShops.map((sh) => Number(sh.clusterid || 1))));
    }
    return [Number(caller.clusterid || 1)];
  }
  if (callerRole === 'delivery agent') {
    return [Number(caller.clusterid || 1)];
  }
  // T0.2: any other role has no cluster scope (was: its own cluster)
  return [];
}

/**
 * Return YYYY-MM-DD in the app's local timezone (Asia/Kolkata).
 */
function getIstDateString(dateObj = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(dateObj);
}

/**
 * Add or subtract days from a YYYY-MM-DD date string safely.
 */
function addDaysToDateStr(dateStr, days) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))
    ? String(dateStr)
    : getIstDateString();
  const dt = new Date(`${base}T00:00:00Z`);
  if (isNaN(dt.getTime())) return base;
  return new Date(dt.getTime() + Number(days) * 86400000).toISOString().slice(0, 10);
}

/**
 * Resolve report period (today, 7d / last_7_days, 30d / last_30_days, or custom fromDate/toDate)
 * consistently in Asia/Kolkata local timezone.
 */
function resolveReportPeriodRange(query = {}) {
  const todayStr = (query.today && /^\d{4}-\d{2}-\d{2}$/.test(String(query.today)))
    ? String(query.today)
    : getIstDateString();
  const rawPeriod = String(query.period || query.range || '').trim().toLowerCase();

  let fromDate = query.fromDate || query.startDate || '';
  let toDate = query.toDate || query.endDate || '';
  let periodKey = 'custom';
  let periodLabel = 'Selected Period';

  if (rawPeriod === 'today' || rawPeriod === '1d') {
    fromDate = todayStr;
    toDate = todayStr;
    periodKey = 'today';
    periodLabel = 'Today';
  } else if (['7d', 'last7days', 'last_7_days', '7days', 'week', 'this_week'].includes(rawPeriod)) {
    fromDate = addDaysToDateStr(todayStr, -6);
    toDate = todayStr;
    periodKey = '7d';
    periodLabel = 'Last 7 days';
  } else if (['30d', 'last30days', 'last_30_days', '30days', 'month', 'this_month'].includes(rawPeriod)) {
    fromDate = addDaysToDateStr(todayStr, -29);
    toDate = todayStr;
    periodKey = '30d';
    periodLabel = 'Last 30 days';
  } else if (rawPeriod === 'all' || rawPeriod === 'all_time') {
    periodKey = 'all';
    periodLabel = 'All time';
  }

  let periodDays = 1;
  if (fromDate && toDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    const d1 = new Date(`${fromDate}T00:00:00Z`);
    const d2 = new Date(`${toDate}T00:00:00Z`);
    if (!isNaN(d1.getTime()) && !isNaN(d2.getTime()) && d2 >= d1) {
      periodDays = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
    }
    if (periodKey === 'custom') {
      if (fromDate === todayStr && toDate === todayStr) {
        periodKey = 'today';
        periodLabel = 'Today';
      } else if (periodDays === 7 && toDate === todayStr) {
        periodKey = '7d';
        periodLabel = 'Last 7 days';
      } else if (periodDays === 30 && toDate === todayStr) {
        periodKey = '30d';
        periodLabel = 'Last 30 days';
      } else {
        periodLabel = `${fromDate} to ${toDate}`;
      }
    }
  } else if (!fromDate && !toDate && periodKey !== 'all') {
    // When no dates or period are specified, keep unfiltered or default metadata to 7d for frequency calculation
    periodDays = 7;
  }

  return {
    todayStr,
    fromDate: fromDate || null,
    toDate: toDate || null,
    periodKey,
    periodLabel,
    periodDays,
    timezone: 'Asia/Kolkata'
  };
}

const PERFORMANCE_INDICATOR_SCALE = [
  { tier: 'excellent', label: 'Excellent (Target Met)', range: '≥ 100%', minPct: 100, maxPct: null, color: '#15803d', bg: '#dcfce7', description: 'Quota achieved or exceeded for the period' },
  { tier: 'good', label: 'Good (On Track)', range: '80% – 99%', minPct: 80, maxPct: 99.99, color: '#0369a1', bg: '#e0f2fe', description: 'Strong progress; nearing target quota' },
  { tier: 'fair', label: 'Needs Improvement', range: '50% – 79%', minPct: 50, maxPct: 79.99, color: '#b45309', bg: '#fef3c7', description: 'Moderate progress; requires follow-up visits' },
  { tier: 'critical', label: 'Below Target (< 50%)', range: '< 50%', minPct: 0, maxPct: 49.99, color: '#b91c1c', bg: '#fee2e2', description: 'Significant gap against target; immediate attention needed' }
];

function getPerformanceIndicator(achievementPct, hasTarget = true) {
  if (!hasTarget) {
    return {
      tier: 'unconfigured',
      label: 'Target Not Set',
      range: 'N/A',
      color: '#475569',
      bg: '#f1f5f9',
      description: 'No target quota configured for this scope'
    };
  }
  const pct = Number(achievementPct || 0);
  if (pct >= 100) return PERFORMANCE_INDICATOR_SCALE[0];
  if (pct >= 80) return PERFORMANCE_INDICATOR_SCALE[1];
  if (pct >= 50) return PERFORMANCE_INDICATOR_SCALE[2];
  return PERFORMANCE_INDICATOR_SCALE[3];
}

/**
 * Compute Frequently Ordered Customers (Sales Manager / Admin ONLY).
 * Frequency definition: an order at least once every two days within the selected period.
 */
function computeFrequentlyOrderedCustomers(ordersInScope = [], shopsInScope = [], periodInfo = {}) {
  const periodDays = Math.max(1, Number(periodInfo.periodDays || 7));
  const minOrdersRequired = periodDays <= 2 ? 1 : Math.max(1, Math.floor(periodDays / 2));
  const startLabel = periodInfo.fromDate || addDaysToDateStr(periodInfo.todayStr || getIstDateString(), -(periodDays - 1));
  const endLabel = periodInfo.toDate || periodInfo.todayStr || getIstDateString();
  const calculationPeriodText = `${startLabel} to ${endLabel} (${periodDays} ${periodDays === 1 ? 'day' : 'days'})`;

  const shopLookup = new Map();
  for (const s of (shopsInScope || [])) {
    shopLookup.set(Number(s.shopid), s);
  }

  const byShop = new Map();
  for (const o of (ordersInScope || [])) {
    const st = String(o.status || '').toLowerCase();
    if (st === 'cancelled') continue;
    const sid = Number(o.customerId || o.shopid || 0);
    if (!sid) continue;
    if (!byShop.has(sid)) {
      const sh = shopLookup.get(sid);
      byShop.set(sid, {
        shopId: sid,
        shopShortId: o.shopId || `S${String(sid).padStart(3, '0')}`,
        shopName: o.customer || o.shopName || sh?.shopName || `Shop #${sid}`,
        shopCategory: o.shopCategory || sh?.shopCategory || 'Retail',
        clusterId: Number(o.clusterId || sh?.clusterid || 1),
        orderCount: 0,
        orderDates: new Set(),
        totalAmount: 0,
        totalQtyKg: 0,
        latestOrderDate: ''
      });
    }
    const rec = byShop.get(sid);
    rec.orderCount += 1;
    const dStr = String(o.date || '').slice(0, 10);
    if (dStr) {
      rec.orderDates.add(dStr);
      if (!rec.latestOrderDate || dStr > rec.latestOrderDate) {
        rec.latestOrderDate = dStr;
      }
    }
    rec.totalAmount += Number(o.total || 0);
    const itemsQty = (o.orderList || []).reduce((s, it) => s + (parseFloat(it.qty) || 0), 0);
    rec.totalQtyKg += itemsQty;
  }

  const customers = Array.from(byShop.values())
    .filter((c) => c.orderCount >= minOrdersRequired)
    .map((c) => {
      const avgDaysPerOrder = Number((periodDays / Math.max(1, c.orderCount)).toFixed(1));
      return {
        shopId: c.shopId,
        shopShortId: c.shopShortId,
        shopName: c.shopName,
        shopCategory: c.shopCategory,
        clusterId: c.clusterId,
        orderCount: c.orderCount,
        distinctOrderDays: c.orderDates.size,
        totalAmount: Number(c.totalAmount.toFixed(2)),
        totalQtyKg: Number(c.totalQtyKg.toFixed(2)),
        latestOrderDate: c.latestOrderDate,
        averageDaysBetweenOrders: avgDaysPerOrder,
        frequencyLabel: `1 order every ${avgDaysPerOrder} ${avgDaysPerOrder === 1 ? 'day' : 'days'}`,
        calculationPeriod: calculationPeriodText,
        periodDays,
        minOrdersRequired
      };
    })
    .sort((a, b) => b.orderCount - a.orderCount || b.totalAmount - a.totalAmount);

  return {
    rule: 'At least 1 order every 2 days within the selected period',
    periodLabel: periodInfo.periodLabel || 'Selected Period',
    calculationPeriod: calculationPeriodText,
    fromDate: startLabel,
    toDate: endLabel,
    periodDays,
    minOrdersRequired,
    count: customers.length,
    customers
  };
}

/**
 * Validate uploaded shop photo buffer (size <= 5MB + genuine magic bytes for JPEG, PNG, or WebP).
 */
function validateShopPhotoUpload(file) {
  if (!file || !file.buffer) {
    return { valid: false, message: 'Empty image upload buffer.' };
  }
  const maxBytes = 5 * 1024 * 1024; // 5 MB
  if (file.buffer.length > maxBytes) {
    return { valid: false, message: 'Uploaded image exceeds maximum allowed size of 5 MB.' };
  }
  if (file.buffer.length < 12) {
    return { valid: false, message: 'Uploaded file is too small to be a valid image.' };
  }

  const buf = file.buffer;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a;
  const isWebp =
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50;

  if (!isJpeg && !isPng && !isWebp) {
    return {
      valid: false,
      message: 'Invalid file format: only genuine JPEG, PNG, or WebP images are permitted.'
    };
  }

  const declaredMime = String(file.mimetype || '').toLowerCase();
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/octet-stream'];
  if (declaredMime && !allowedMimes.includes(declaredMime)) {
    return {
      valid: false,
      message: `Unsupported MIME type '${declaredMime}'. Only JPEG, PNG, and WebP are permitted.`
    };
  }

  const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
  return { valid: true, ext };
}

// ============================================================================
// EXPRESS APPLICATION & SECURITY MIDDLEWARE
// ============================================================================

const app = express();
// Every handler registered below is wrapped so rejected promises reach the error middleware
wrapAsyncRoutes(app);
// Every route must be declared in server/access.js (startup refusal) and passes its audience gate first
const routeAccess = installRouteDeclarations(app, { getCaller, authFailureCode: (req) => req._authFailure || 'AUTH_REQUIRED' });
const port = process.env.PORT || 3001;

app.use(requestIdMiddleware);

// T0.8: every 401/403 from a protected route carries a machine-readable `code` (added, never replacing a field).
// 401: AUTH_REQUIRED | AUTH_MALFORMED | AUTH_CONFLICT | SESSION_INVALID | SESSION_EXPIRED; 403: FORBIDDEN unless set.
// Public routes (sign-in, setup, health) are left as they were.
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if ((res.statusCode === 401 || res.statusCode === 403) && req._routeAudience && req._routeAudience !== 'public'
        && body && typeof body === 'object' && !Array.isArray(body) && body.code === undefined) {
      body = { ...body, code: res.statusCode === 401 ? (req._authFailure || 'AUTH_REQUIRED') : 'FORBIDDEN' };
    }
    return json(body);
  };
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 + 1024 } // Handled explicitly with clear 400 message
});

// Reverse Proxy Support (Render, Cloudflare, AWS, etc.)
if (process.env.TRUST_PROXY === 'true' || isProduction) {
  app.set('trust proxy', 1);
}

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Strict site-wide privacy: never leak application paths, query strings, or origins in standard HTTP traffic.
  // Map tile layers that require origin validation configure element-scoped referrerPolicy on their own <img> elements.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  if (isProduction || req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Restricted CORS Configuration
const getAllowedOrigins = (req) => {
  const configured = (process.env.CORS_ALLOWED_ORIGINS || '').trim();
  const allowed = configured
    ? configured.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  // Always permit same-origin requests (frontend served by the same host)
  const host = req?.get ? req.get('host') : req?.headers?.host;
  if (host) {
    allowed.push(`https://${host}`, `http://${host}`);
  }

  // Mobile APK (Capacitor) origins
  allowed.push('capacitor://localhost', 'https://localhost', 'http://localhost');

  if (!isProduction) {
    allowed.push(
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001'
    );
  }

  return allowed;
};

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    return next();
  }
  const allowed = getAllowedOrigins(req);
  let isAllowed = allowed.includes(origin);

  // Also check if origin host matches the request's own host (same-origin)
  if (!isAllowed) {
    try {
      const originHost = new URL(origin).host;
      const reqHost = req.get('host');
      if (originHost && reqHost && originHost === reqHost) {
        isAllowed = true;
      }
    } catch {}
  }

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token, X-Idempotency-Key, X-Device-Event-Time, X-LineCart-Client, X-Request-Id');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  }
  return res.status(403).json({
    status: 403,
    message: 'CORS Policy: Origin is not permitted.'
  });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Safe Request Logger (NEVER logs passwords, tokens, or sensitive query parameters)
app.use((req, res, next) => {
  if (req.url.startsWith('http://freshcubes.in')) {
    req.url = req.url.replace('http://freshcubes.in', '');
  }
  const safePath = req.path || req.url.split('?')[0];
  const startedAt = Date.now();
  res.on('finish', () => {
    logEvent(res.statusCode >= 500 ? 'error' : 'info', 'request', {
      requestId: req.requestId,
      method: req.method,
      path: safePath,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
});

// Pre-resolve authenticated session caller for all incoming requests
app.use(async (req, res, next) => {
  try {
    await getCallerAsync(req);
    next();
  } catch (err) {
    next(err);
  }
});

// Serve static item catalog icons (non-sensitive product images)
const itemsDir = path.join(__dirname, '../client/public/items');
app.use('/items', express.static(itemsDir));
app.use('/admin_panel/storage/app/public/LC_customer/items', express.static(itemsDir));

// Serve static frontend build
// In production, strictly serve production dist (no demo controls/credentials).
// In development/pilot mode, serve dist-demo if available, otherwise dist.
const clientDistDemo = path.join(__dirname, '../client/dist-demo');
const clientDistProd = path.join(__dirname, '../client/dist');
const clientDist = (!isProduction && fs.existsSync(clientDistDemo))
  ? clientDistDemo
  : clientDistProd;
console.log(`[Frontend] Serving static frontend from: ${clientDist} (isProduction: ${isProduction})`);
app.use(express.static(clientDist));

// ============================================================================
// PUBLIC SYSTEM & AUTHENTICATION ENDPOINTS
// ============================================================================

// Reachability probe used by the apps before submitting orders (no database work)
app.get('/api/ping', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 200, ok: true, time: new Date().toISOString() });
});

// Cloud & Service Health Check Endpoint (public, lightweight, verified against live database)
app.get(['/health', '/api/health'], async (req, res) => {
  try {
    const shopsRes = await db.query('SELECT COUNT(*) AS cnt FROM shops');
    const shopsCount = Number(shopsRes.rows[0]?.cnt || 0);
    const ordersRes = await db.query('SELECT COUNT(*) AS cnt FROM orders');
    const ordersCount = Number(ordersRes.rows[0]?.cnt || 0);
    const usersRes = await db.query('SELECT COUNT(*) AS cnt FROM users');
    const usersCount = Number(usersRes.rows[0]?.cnt || 0);
    let migrations = [];
    try {
      const migRes = await db.query('SELECT version FROM schema_migrations ORDER BY version ASC');
      migrations = (migRes.rows || []).map((r) => r.version);
    } catch {}

    res.json({
      status: 'healthy',
      service: 'linecart-backend',
      environment: isProduction ? (process.env.APP_ENV || 'production') : 'development',
      database: {
        mode: db.mode,
        connected: true,
        shopsCount,
        usersCount,
        ordersCount,
        migrations
      },
      storage: {
        provider: useSupabaseStorage ? 'supabase-storage' : 'local-disk'
      },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'linecart-backend',
      database: {
        mode: db.mode,
        connected: false,
        error: err.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// ---------------------------------------------------------------------------
// One-time initial Admin setup
// In production/staging the request must carry the SETUP_TOKEN environment value as
//   Authorization: Setup <token>
// Without SETUP_TOKEN configured, setup is disabled in production (use INITIAL_ADMIN_* or migrate.js).
// The endpoint never modifies an existing account; it only creates a new Admin.
// ---------------------------------------------------------------------------
const SETUP_TOKEN_MIN_LENGTH = 24;

function getConfiguredSetupToken() {
  const token = String(process.env.SETUP_TOKEN || '').trim();
  return token.length >= SETUP_TOKEN_MIN_LENGTH ? token : '';
}

function isSetupTokenRequired() {
  return isProduction || Boolean(getConfiguredSetupToken());
}

function extractSetupToken(req) {
  const header = String(req.headers['authorization'] || '');
  return header.toLowerCase().startsWith('setup ') ? header.slice(6).trim() : '';
}

function setupTokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function findActiveValidAdmins() {
  return salesPersons.filter(
    (s) =>
      (s.role || '').toLowerCase() === 'admin' &&
      Number(s.active) === 1 &&
      s.phoneValid &&
      Boolean(s.passwordHash)
  );
}

// System environment & setup status endpoint (minimal public info, no private data)
app.get('/api/system/mode', async (req, res) => {
  await refreshStateFromDb();
  const activeValidAdmins = findActiveValidAdmins();
  const requiresAdminSetup = activeValidAdmins.length === 0;
  res.json({
    status: 200,
    production: isProduction,
    demoMode: !isProduction,
    hasActiveAdmin: !requiresAdminSetup,
    requiresAdminSetup,
    setupTokenRequired: requiresAdminSetup && isSetupTokenRequired(),
    setupAvailable: requiresAdminSetup && (!isProduction || Boolean(getConfiguredSetupToken()))
  });
});

// One-time Initial Admin Setup endpoint (ONLY available when no active Admin has a valid password & mobile)
app.post('/api/system/setup-admin', async (req, res) => {
  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
  const SETUP_RATE_KEY = 'setup-admin';

  if (isSetupTokenRequired()) {
    const expected = getConfiguredSetupToken();
    if (!expected) {
      return res.status(403).json({
        status: 403,
        message: 'Administrator setup is disabled on this server. Configure SETUP_TOKEN, or use INITIAL_ADMIN_PHONE / INITIAL_ADMIN_PASSWORD, or `npm run admin:reset-password --prefix server`.'
      });
    }
    if (await isLoginRateLimited(clientIp, SETUP_RATE_KEY)) {
      return res.status(429).json({ status: 429, message: 'Too many failed setup attempts. Please wait 15 minutes.' });
    }
    if (!setupTokenMatches(extractSetupToken(req), expected)) {
      await recordFailedLoginAttempt(clientIp, SETUP_RATE_KEY);
      logEvent('warn', 'admin_setup_denied', { requestId: req.requestId, reason: 'invalid_or_missing_setup_token' });
      return res.status(403).json({ status: 403, message: 'A valid setup token is required to configure the Administrator.' });
    }
  }

  await refreshStateFromDb();
  if (findActiveValidAdmins().length > 0) {
    return res.status(403).json({
      status: 403,
      message: 'Initial Administrator is already configured. Sign in as Admin to manage accounts.'
    });
  }

  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : 'LineCart Administrator';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!isValidIndianMobile(phone)) {
    return res.status(400).json({
      status: 400,
      message: 'Mobile number must be an Indian mobile number containing exactly 10 digits starting with 6, 7, 8, or 9.'
    });
  }

  if (password.length < 8 || isKnownDemoPassword(password)) {
    return res.status(400).json({
      status: 400,
      message: 'Password must be at least 8 characters long and must not be a known demo or default password.'
    });
  }

  // Never take over an existing account (Admin or otherwise)
  if (salesPersons.some((s) => s.phone === phone)) {
    return res.status(400).json({
      status: 400,
      message: 'That mobile number already belongs to an existing account. Use a different number.'
    });
  }

  const newHash = hashPassword(password);
  let adminId = 0;
  let alreadyConfigured = false;

  await db.withTransaction(async (tx) => {
    await db.lockAllocation(tx, 'users');
    // Re-check inside the lock so two simultaneous setups cannot both succeed
    const adminCheck = await tx.query(
      "SELECT COUNT(*) AS cnt FROM users WHERE role = 'Admin' AND active = 1 AND phone_valid = 1 AND password_hash IS NOT NULL"
    );
    if (Number(adminCheck.rows[0]?.cnt || 0) > 0) {
      alreadyConfigured = true;
      return;
    }
    const idRes = await tx.query('SELECT COALESCE(MAX(id), 899) + 1 AS next_id FROM users');
    adminId = Math.max(Number(idRes.rows[0]?.next_id || 900), 900);
    await tx.query(
      `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
       VALUES ($1, $2, 'Admin', $3, 1, $4, 0, 1, 1, $5)`,
      [adminId, name, phone, newHash, new Date().toISOString().slice(0, 19).replace('T', ' ')]
    );
  });

  if (alreadyConfigured) {
    return res.status(403).json({
      status: 403,
      message: 'Initial Administrator is already configured. Sign in as Admin to manage accounts.'
    });
  }

  await clearLoginAttempts(SETUP_RATE_KEY);
  await refreshStateFromDb();
  await addAuditLog(req, 'ADMIN_INITIAL_SETUP', 'User', adminId, `Configured initial Administrator (${name})`);

  return res.status(201).json({
    status: 201,
    message: 'Initial Administrator account configured successfully. You may now sign in.'
  });
});

// Canonical synthetic demo accounts for local development and testing
const DEV_DEMO_ACCOUNTS = [
  {
    id: 950,
    name: 'Demo Admin',
    role: 'Admin',
    phone: '9876500099',
    password: 'password123',
    cluster_id: 1,
    description: 'System administration, user roles & command center'
  },
  {
    id: 100,
    name: 'Demo Sales Manager',
    role: 'Sales Manager',
    phone: '9876500001',
    password: 'password123',
    cluster_id: 1,
    description: 'Team performance, orders, maps & quotas'
  },
  {
    id: 6,
    name: 'Demo Field Agent',
    role: 'Field Sales Agent',
    phone: '9876543210',
    password: 'password123',
    cluster_id: 1,
    description: 'Shop orders, customer registration & catalogs'
  },
  {
    id: 50,
    name: 'Demo Delivery Agent',
    role: 'Delivery Agent',
    phone: '9876500050',
    password: 'password123',
    cluster_id: 1,
    description: 'Delivery route fulfillment & stop updates'
  }
];

async function ensureDevelopmentDemoAccounts() {
  if (isProduction || (db.mode === 'postgres' && !isLocalTestPostgres())) return;

  await db.withTransaction(async (tx) => {
    for (const acc of DEV_DEMO_ACCOUNTS) {
      const existing = await tx.query(
        'SELECT id, phone, password_hash FROM users WHERE id = $1 OR phone = $2',
        [acc.id, acc.phone]
      );
      const pwdHash = hashPassword(acc.password);
      if (existing.rowCount === 0) {
        await tx.query(
          `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
           VALUES ($1, $2, $3, $4, 1, $5, 0, $6, 1, '2026-04-01 09:00:00')`,
          [acc.id, acc.name, acc.role, acc.phone, pwdHash, acc.cluster_id]
        );
      } else {
        const u = existing.rows[0];
        // Ensure demo password hash is set for dev testing (Real Admin 900 / 9870000001 is NEVER touched)
        if (Number(u.id) !== 900 && u.phone !== '9870000001') {
          await tx.query(
            'UPDATE users SET password_hash = $1, must_change_password = 0, active = 1, phone_valid = 1 WHERE id = $2',
            [pwdHash, Number(u.id)]
          );
        }
      }
    }
  });
}

// Demo users helper endpoint (strictly disabled in cloud/staging/production mode)
app.get('/api/demo-users', async (req, res) => {
  if (isProduction || (db.mode === 'postgres' && !isLocalTestPostgres())) {
    return res.status(403).json({
      status: 403,
      message: 'Demo accounts are disabled in cloud/staging/production mode.',
      demoRoles: [],
      users: []
    });
  }
  await refreshStateFromDb();

  const demoRoles = DEV_DEMO_ACCOUNTS.map((dr) => ({
    role: dr.role,
    name: dr.name,
    phone: dr.phone,
    defaultPassword: dr.password,
    description: dr.description
  }));

  const safeUsers = salesPersons
    .filter((u) => u.phone !== '9870000001' && u.phoneValid && Number(u.active) === 1)
    .map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      phone: u.phone,
      clusterid: u.clusterid,
      active: u.active
    }));

  res.json({
    status: 200,
    demoRoles,
    users: safeUsers
  });
});

// 1. POST /login (Credentials accepted ONLY in POST request body; strict 10-digit Indian mobile validation)
const handleLogin = async (req, res) => {
  try {
    // Reject any request that passes credentials in URL query parameters
    if (
      req.query &&
      (req.query.password !== undefined ||
        req.query.phone !== undefined ||
        req.query.username !== undefined ||
        req.query.userid !== undefined)
    ) {
      return res.status(400).json({
        status: 400,
        message: 'Security Error: Credentials must be sent in the POST request body only; URL query parameters are not accepted.',
        result: []
      });
    }

    const rawPhone = req.body?.phone;
    const rawPassword = req.body?.password;

    if (typeof rawPhone !== 'string' || typeof rawPassword !== 'string' || !rawPhone || !rawPassword) {
      return res.status(400).json({
        status: 400,
        message: 'A 10-digit Indian mobile number and password are required in the request body.',
        result: []
      });
    }

    // Strict Indian mobile validation: exactly 10 digits starting with 6, 7, 8, or 9.
    // Reject usernames, spaces, country codes (+91), dashes, short/long numbers, or non-digits.
    if (!INDIAN_MOBILE_REGEX.test(rawPhone)) {
      return res.status(400).json({
        status: 400,
        message: 'Enter a valid 10-digit Indian mobile number beginning with 6, 7, 8, or 9 (no spaces, country codes, or usernames).',
        result: []
      });
    }

    const clientIp = req.ip || (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : null) || req.socket?.remoteAddress || 'unknown';
    if (await isLoginRateLimited(clientIp, rawPhone)) {
      return res.status(429).json({
        status: 429,
        message: 'Too many failed sign-in attempts. Please wait 15 minutes before trying again.',
        result: []
      });
    }

    await refreshStateFromDb();

    // Look up strictly by exact 10-digit Indian mobile number
    const found = salesPersons.find((s) => s.phone === rawPhone && s.phoneValid);

    // In production mode, strictly reject synthetic demo accounts and known demo passwords
    if (isProduction) {
      if (isKnownDemoPassword(rawPassword)) {
        await recordFailedLoginAttempt(clientIp, rawPhone);
        return res.status(401).json({
          status: 401,
          message: 'Security Policy: Demo credentials and known default passwords are strictly rejected in production.',
          result: []
        });
      }
      if (found && (Number(found.id) === 950 || found.phone === '9876500099')) {
        return res.status(403).json({
          status: 403,
          message: 'Security Policy: Demo accounts are disabled in production mode.',
          result: []
        });
      }
    }

    if (!found || !found.passwordHash) {
      await recordFailedLoginAttempt(clientIp, rawPhone);
      return res.status(401).json({
        status: 401,
        message: 'Invalid mobile number or password.',
        result: []
      });
    }

    const isPasswordValid = verifyPassword(rawPassword, found.passwordHash);
    if (!isPasswordValid) {
      await recordFailedLoginAttempt(clientIp, rawPhone);
      return res.status(401).json({
        status: 401,
        message: 'Invalid mobile number or password.',
        result: []
      });
    }

    if (Number(found.active) === 0) {
      return res.status(403).json({
        status: 403,
        message: 'Account is deactivated. Please contact an Administrator.',
        result: []
      });
    }

    await clearLoginAttempts(rawPhone);
    const token = await createSession(found);

    const safeUser = {
      id: found.id,
      name: found.name,
      role: found.role,
      phone: found.phone,
      clusterid: found.clusterid,
      active: found.active,
      createdon: found.createdon,
      mustChangePassword: Boolean(found.mustChangePassword)
    };

    return res.json({
      status: 200,
      message: 'Login successful',
      token,
      result: [safeUser]
    });
  } catch (err) {
    console.error('[Login Error]', err.message);
    return res.status(500).json({
      status: 500,
      message: 'An internal error occurred during sign-in.',
      result: []
    });
  }
};

app.post('/login', handleLogin);
app.post('/api/linecart/login', handleLogin);
app.post('/admin_panel/public/api/linecart/login', handleLogin);

// GET /api/auth/me - Verify active session and return authoritative user & role
app.get('/api/auth/me', requireAuth, async (req, res) => {
  const caller = getCaller(req);
  const safeUser = { ...caller };
  delete safeUser.password;
  delete safeUser.passwordHash;
  delete safeUser.sessionToken;
  return res.json({
    status: 200,
    authenticated: true,
    user: safeUser,
    role: safeUser.role
  });
});

// POST /api/auth/logout - Revoke active session token in database
app.post('/api/auth/logout', async (req, res) => {
  const token = extractBearerToken(req);
  if (token) {
    await revokeSessionByToken(token);
  }
  return res.json({
    status: 200,
    message: 'Logged out successfully'
  });
});

// POST /api/auth/logout-all - Revoke every session of the signed-in user, this one included (T0.8)
app.post('/api/auth/logout-all', async (req, res) => {
  const caller = getCaller(req);
  const result = await db.query(
    'UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL',
    [Date.now(), Number(caller.id)]
  );
  await addAuditLog(req, 'USER_LOGOUT_ALL', 'User', caller.id, `Signed out of all devices (${result.rowCount || 0} session(s))`);
  return res.json({ status: 200, message: 'Signed out on all devices.', revokedSessions: result.rowCount || 0 });
});

// POST /api/auth/change-password (Authenticated Self-Service or First-Login Password Change)
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const caller = getCaller(req);
  const { userId, currentPassword, newPassword } = req.body || {};

  // Prevent changing another user's password unless Admin
  if (userId !== undefined && Number(userId) !== Number(caller.id) && (caller.role || '').toLowerCase() !== 'admin') {
    return res.status(403).json({
      status: 403,
      message: 'Access Denied: You can only change your own password.'
    });
  }

  const targetUserId = userId && (caller.role || '').toLowerCase() === 'admin' ? Number(userId) : Number(caller.id);

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      status: 400,
      message: 'Current password and new password are required.'
    });
  }

  await refreshStateFromDb();
  const user = salesPersons.find((s) => Number(s.id) === targetUserId);
  if (!user) {
    return res.status(404).json({ status: 404, message: 'User not found.' });
  }

  if (!user.passwordHash || !verifyPassword(String(currentPassword), user.passwordHash)) {
    return res.status(400).json({ status: 400, message: 'Current password is incorrect.' });
  }

  const trimmedNew = String(newPassword).trim();
  if (trimmedNew.length < 8) {
    return res.status(400).json({ status: 400, message: 'New password must be at least 8 characters long.' });
  }

  if (isKnownDemoPassword(trimmedNew) || trimmedNew === String(currentPassword)) {
    return res.status(400).json({
      status: 400,
      message: 'New password cannot be a known demo password or match your current password.'
    });
  }

  const newHash = hashPassword(trimmedNew);
  await db.query(
    'UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2',
    [newHash, targetUserId]
  );

  // R14 (T0.8): sign the account out everywhere else. Own change keeps the current session so installed
  // apps stay signed in on this device; an admin changing someone else's password signs them out fully.
  const revokedSessions = targetUserId === Number(caller.id)
    ? await revokeOtherUserSessions(targetUserId, caller.sessionToken)
    : (await db.query('UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL', [Date.now(), targetUserId])).rowCount || 0;

  await refreshStateFromDb();
  await addAuditLog(req, 'USER_PASSWORD_CHANGE', 'User', user.id, `Password changed for user ${user.name} (${user.role}); ${revokedSessions} other session(s) signed out`);

  res.json({
    status: 200,
    message: 'Password changed successfully.',
    revokedSessions
  });
});

// Authenticated User Profile Lookup (GET /users/:id and GET /api/users/:id)
const handleGetUserById = async (req, res) => {
  const caller = getCaller(req);
  if (!caller) {
    return res.status(401).json({ status: 401, message: 'Authentication required.' });
  }

  const targetId = Number(req.params.id);
  const callerRole = (caller.role || '').toLowerCase();
  const isSelf = Number(caller.id) === targetId;
  const isAdmin = callerRole === 'admin';
  const isAssignedToManager = callerRole === 'sales manager' && getAssignedAgentIds(caller.id).includes(targetId);

  if (!isSelf && !isAdmin && !isAssignedToManager) {
    return res.status(403).json({
      status: 403,
      message: 'Access Denied: You are not authorized to view this user profile.'
    });
  }

  await refreshStateFromDb();
  const user = salesPersons.find((s) => Number(s.id) === targetId);
  if (!user) {
    return res.status(404).json({ status: 404, message: 'User not found.' });
  }

  return res.json({
    status: 200,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      phone: user.phone,
      clusterid: user.clusterid,
      active: user.active,
      createdon: user.createdon
    }
  });
};

app.get('/users/:id', requireAuth, handleGetUserById);
app.get('/api/users/:id', requireAuth, handleGetUserById);

// ============================================================================
// FIELD SALES, CATALOG, SHOP REGISTRATION & ORDER CREATION ENDPOINTS
// ============================================================================

// T0.6 (R12): an order may be credited only to an existing, active sales user
const CREDITABLE_ROLES = ['Field Sales Agent', 'Sales Manager', 'Admin'];
function findCreditableSalesperson(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, reason: 'is not a valid user id' };
  const user = salesPersons.find((s) => Number(s.id) === n);
  if (!user) return { ok: false, reason: 'does not exist' };
  if (Number(user.active ?? 1) === 0) return { ok: false, reason: 'is deactivated' };
  if (!CREDITABLE_ROLES.includes(canonicalRole(user.role))) return { ok: false, reason: 'is not a sales user' };
  return { ok: true, user };
}

/**
 * Helper to validate caller access to a requested spersonId parameter on field endpoints.
 */
function verifyFieldAgentScope(req, res, requestedSpersonId) {
  const caller = getCaller(req);
  if (!caller) {
    res.status(401).json({
      status: 401,
      message: 'Authentication required: valid Bearer session token must be provided.'
    });
    return { authorized: false };
  }

  const callerRole = (caller.role || '').toLowerCase();
  const reqId = requestedSpersonId !== undefined && requestedSpersonId !== null && requestedSpersonId !== ''
    ? Number(requestedSpersonId)
    : Number(caller.id);

  if (callerRole === 'admin') {
    return { authorized: true, caller, effectiveSpersonId: reqId };
  }

  if (callerRole === 'sales manager') {
    const assigned = getAssignedAgentIds(caller.id);
    if (reqId !== Number(caller.id) && !assigned.includes(reqId)) {
      res.status(403).json({
        status: 403,
        message: `Access Denied: Agent #${reqId} is not assigned to Sales Manager #${caller.id}.`
      });
      return { authorized: false };
    }
    return { authorized: true, caller, effectiveSpersonId: reqId };
  }

  if (callerRole === 'field sales agent') {
    if (reqId !== Number(caller.id)) {
      res.status(403).json({
        status: 403,
        message: `Access Denied: Field Sales Agents can only access records for their own account (Caller ID: ${caller.id}, Requested ID: ${reqId}).`
      });
      return { authorized: false };
    }
    return { authorized: true, caller, effectiveSpersonId: Number(caller.id) };
  }

  res.status(403).json({
    status: 403,
    message: `Access Denied: Role '${caller.role}' is not permitted to access this field sales endpoint.`
  });
  return { authorized: false };
}

/**
 * Shop ids a Delivery Agent may reach (T0.2, L7 owner decision 23 Nov 2026): every shop with at
 * least one order assigned to this agent, whatever its status. Closed deliveries (Delivered,
 * Cancelled, Rejected) keep the shop in scope as history; shops never assigned stay out.
 * Orders are matched to shops the same way as GET /api/delivery/orders (customer id, or the
 * S-prefixed shop id).
 */
function getDeliveryAgentShopIds(deliveryAgentId) {
  const ids = new Set();
  for (const o of submittedOrders) {
    if (o.deliveryAgentId === null || o.deliveryAgentId === undefined) continue;
    if (Number(o.deliveryAgentId) !== Number(deliveryAgentId)) continue;
    if (o.customerId !== undefined && o.customerId !== null && o.customerId !== '') ids.add(Number(o.customerId));
    if (o.shopId) {
      const n = Number(String(o.shopId).replace(/^S0*/, ''));
      if (Number.isFinite(n)) ids.add(n);
    }
  }
  return ids;
}

/**
 * Strict shop-level access authorization guard.
 * Determines whether the authenticated caller has permission to view records / order history for a specific shop.
 */
function canCallerAccessShop(caller, shop) {
  if (!caller || !shop) return false;
  const role = (caller.role || '').toLowerCase();

  // Administrator has unrestricted organization-wide access
  if (role === 'admin') return true;

  const shopClusterId = Number(shop.cluster_id || shop.clusterid || 0);
  const shopCreatedBy = Number(shop.created_by || shop.createdby || 0);
  const rawAssignedAgentId = shop.assignedAgentId !== undefined && shop.assignedAgentId !== null
    ? shop.assignedAgentId
    : (shop.assigned_agent_id !== undefined && shop.assigned_agent_id !== null ? shop.assigned_agent_id : null);
  const assignedAgentId = rawAssignedAgentId !== null && !isNaN(Number(rawAssignedAgentId)) && Number(rawAssignedAgentId) > 0
    ? Number(rawAssignedAgentId)
    : null;
  const callerClusterId = Number(caller.cluster_id || caller.clusterid || 0);
  const callerId = Number(caller.id || 0);

  // Sales Manager: authorized for shops in their supervised cluster, or assigned to/created by assigned agents
  if (role === 'sales manager') {
    if (
      !checkActionPermission(caller.role, 'view_cluster_shops') &&
      !checkActionPermission(caller.role, 'view_shops') &&
      !checkActionPermission(caller.role, 'view_team_orders')
    ) {
      return false;
    }
    const assignedAgentIds = getAssignedAgentIds(callerId);
    if ((assignedAgentId && assignedAgentIds.includes(assignedAgentId)) || (shopCreatedBy && assignedAgentIds.includes(shopCreatedBy))) {
      return true;
    }
    // T0.2: cluster 0 is no longer a wildcard for every cluster
    if (callerClusterId > 0 && callerClusterId === shopClusterId) {
      return true;
    }
    const assignedAgents = salesPersons.filter((u) => assignedAgentIds.includes(Number(u.id)));
    if (assignedAgents.some((u) => Number(u.clusterid || u.cluster_id) === shopClusterId)) {
      return true;
    }
    return false;
  }

  // Field Sales Agent: authorized strictly for shops assigned to them (never NULL, unassigned or other agents)
  if (role === 'field sales agent') {
    if (
      !checkActionPermission(caller.role, 'view_assigned_shops') &&
      !checkActionPermission(caller.role, 'view_cluster_shops') &&
      !checkActionPermission(caller.role, 'view_shops') &&
      !checkActionPermission(caller.role, 'create_order')
    ) {
      return false;
    }
    if (assignedAgentId === null || assignedAgentId === 0) {
      return false;
    }
    return assignedAgentId === callerId;
  }

  // Delivery Agent: only shops with a delivery assigned to them, open or closed (T0.2/L7; was: every shop in their cluster)
  if (role === 'delivery agent') {
    return getDeliveryAgentShopIds(callerId).has(Number(shop.shopid ?? shop.shop_id));
  }

  return false;
}

// Compute live cluster statistics from real persisted database shops & orders
function computeClusterStatsForScope(clusterId, scopedOrders = null, scopedShops = null, allDateScopedOrders = null) {
  const cId = Number(clusterId);
  const clusterShops = (scopedShops !== null ? scopedShops : shops).filter(
    (s) => Number(s.clusterid || s.cluster_id) === cId
  );
  const allOrders = scopedOrders !== null ? scopedOrders : submittedOrders;
  const fullClusterOrders = (allDateScopedOrders !== null ? allDateScopedOrders : allOrders).filter((o) => {
    if (Number(o.clusterId || o.cluster_id) !== cId) return false;
    const st = String(o.status || '').toLowerCase();
    return st !== 'cancelled';
  });

  // Non-cancelled orders for this cluster within current date filter
  const clusterOrders = allOrders.filter((o) => {
    if (Number(o.clusterId || o.cluster_id) !== cId) return false;
    const st = String(o.status || '').toLowerCase();
    return st !== 'cancelled';
  });

  // Unique shops with at least one active order or visit in this cluster
  const orderedShopIds = new Set();
  const visitedShopIds = new Set();
  clusterOrders.forEach((o) => {
    const sId = Number(o.customerId || o.shopid || o.shopId || 0);
    if (sId > 0) {
      orderedShopIds.add(sId);
      visitedShopIds.add(sId);
    }
  });

  const assignedShopsCount = clusterShops.length;
  const orderedShopsCount = orderedShopIds.size;
  const visitedShopsCount = visitedShopIds.size;
  const totalshops = assignedShopsCount;
  const totalorderedshops = Math.min(totalshops, orderedShopsCount);
  const totalnotorderedshops = Math.max(0, totalshops - totalorderedshops);

  // Group items by itemid from real persisted orderList lines
  const itemMap = new Map();

  for (const o of clusterOrders) {
    const orderStatus = String(o.status || '').toLowerCase();
    const isDelivered = orderStatus === 'delivered';
    const isPendingApproval = orderStatus === 'price approval pending';
    const orderDateStr = String(o.date || o.orderDate || '').slice(0, 10);
    const expDeliveryDate = o.expectedDeliveryDate || (orderDateStr ? addDaysToDateStr(orderDateStr, 1) : '');

    const lines = Array.isArray(o.orderList) ? o.orderList : [];
    for (const item of lines) {
      const itemId = Number(item.itemid || item.itemId || 0);
      if (itemId <= 0) continue;
      const itemName = String(item.itemName || item.name || `Item ${itemId}`);
      const qty = parseFloat(item.qty || 0) || 0;
      if (qty <= 0) continue;
      const unitType = String(item.unitType || item.unit || 'kg');

      if (!itemMap.has(itemId)) {
        itemMap.set(itemId, {
          id: itemId,
          name: itemName,
          unit: unitType.toLowerCase().startsWith('kg') ? 'kg' : unitType,
          totalcount: 0,
          delivered: 0,
          inprogress: 0,
          pendingApproval: 0,
          inProgressOrders: []
        });
      }

      const entry = itemMap.get(itemId);
      entry.totalcount += qty;
      if (isDelivered) {
        entry.delivered += qty;
      } else if (isPendingApproval) {
        entry.pendingApproval += qty;
      } else {
        entry.inprogress += qty;
        entry.inProgressOrders.push({
          orderId: o.orderId || o.id,
          id: o.id || o.orderId,
          shopId: o.shopId || o.customerId,
          shopName: o.shopName || o.customer || 'Shop',
          shopCategory: o.shopCategory || 'Retail',
          agentName: o.agentName || '',
          date: orderDateStr,
          expectedDeliveryDate: expDeliveryDate,
          status: o.status || 'In progress',
          itemQty: qty,
          unit: entry.unit,
          total: Number(o.total || 0),
          orderList: lines.filter((l) => (parseFloat(l.qty) || 0) > 0).map((l) => ({
            itemid: l.itemid || l.itemId,
            itemName: l.itemName || l.name || `Item ${l.itemid || l.itemId}`,
            qty: parseFloat(l.qty) || 0,
            unit: (l.unitType || l.unit || 'kg').toLowerCase().startsWith('kg') ? 'kg' : (l.unitType || l.unit || 'kg'),
            price: parseFloat(l.price || l.custprice || l.actprice || 0),
            requestedPrice: l.requestedPrice !== undefined && l.requestedPrice !== null ? parseFloat(l.requestedPrice) : null,
            priceRequestStatus: l.priceRequestStatus || null
          }))
        });
      }
    }
  }

  // Build dailyDeliveryStatus (including previous days so selecting an In Progress count for a previous day opens matching orders)
  const byDateMap = new Map();
  for (const o of fullClusterOrders) {
    const dStr = String(o.date || o.orderDate || '').slice(0, 10);
    if (!dStr) continue;
    const expDeliv = o.expectedDeliveryDate || addDaysToDateStr(dStr, 1);
    if (!byDateMap.has(dStr)) {
      byDateMap.set(dStr, {
        date: dStr,
        expectedDeliveryDate: expDeliv,
        totalOrders: 0,
        deliveredCount: 0,
        inProgressCount: 0,
        pendingApprovalCount: 0,
        totalQty: 0,
        deliveredQty: 0,
        inProgressQty: 0,
        inProgressOrders: [],
        allOrders: []
      });
    }
    const dayEntry = byDateMap.get(dStr);
    dayEntry.totalOrders += 1;
    const st = String(o.status || '').toLowerCase();
    const isDeliv = st === 'delivered';
    const isPend = st === 'price approval pending';
    const activeLines = (Array.isArray(o.orderList) ? o.orderList : [])
      .filter((l) => (parseFloat(l.qty) || 0) > 0)
      .map((l) => ({
        itemid: l.itemid || l.itemId,
        itemName: l.itemName || l.description || l.name || `Item ${l.itemid || l.itemId}`,
        description: l.itemName || l.description || l.name || `Item ${l.itemid || l.itemId}`,
        qty: parseFloat(l.qty) || 0,
        unit: String(l.unitType || l.unit || 'kg').toLowerCase().startsWith('kg') ? 'kg' : String(l.unitType || l.unit || 'kg'),
        price: parseFloat(l.price || l.custprice || l.actprice || 0),
        requestedPrice: l.requestedPrice !== undefined && l.requestedPrice !== null ? parseFloat(l.requestedPrice) : null,
        priceRequestStatus: l.priceRequestStatus || null
      }));
    const orderQty = activeLines.reduce((s, l) => s + l.qty, 0);
    dayEntry.totalQty = Number((dayEntry.totalQty + orderQty).toFixed(2));

    const orderSummaryObj = {
      orderId: o.orderId || o.id,
      id: o.id || o.orderId,
      shopId: o.shopId || `S${String(o.customerId || '').padStart(3, '0')}`,
      customerId: o.customerId || o.shopid,
      shopName: o.shopName || o.customer || 'Shop',
      shopCategory: o.shopCategory || 'Retail',
      agentName: o.agentName || '',
      spersonid: o.spersonid,
      date: dStr,
      expectedDeliveryDate: expDeliv,
      status: o.status || 'In progress',
      total: Number(o.total || 0),
      totalQty: Number(orderQty.toFixed(2)),
      itemsCount: activeLines.length,
      locationText: o.locationText || null,
      visitPhotoStatus: o.visitPhotoStatus || null,
      orderList: activeLines
    };
    dayEntry.allOrders.push(orderSummaryObj);

    if (isDeliv) {
      dayEntry.deliveredCount += 1;
      dayEntry.deliveredQty = Number((dayEntry.deliveredQty + orderQty).toFixed(2));
    } else if (isPend) {
      dayEntry.pendingApprovalCount += 1;
      dayEntry.inProgressCount += 1;
      dayEntry.inProgressQty = Number((dayEntry.inProgressQty + orderQty).toFixed(2));
      dayEntry.inProgressOrders.push(orderSummaryObj);
    } else {
      dayEntry.inProgressCount += 1;
      dayEntry.inProgressQty = Number((dayEntry.inProgressQty + orderQty).toFixed(2));
      dayEntry.inProgressOrders.push(orderSummaryObj);
    }
  }

  const dailyDeliveryStatus = Array.from(byDateMap.values()).sort((a, b) => b.date.localeCompare(a.date));

  // deliverystatus: only commodities actually ordered
  const deliverystatus = Array.from(itemMap.values()).map((rec) => ({
    id: rec.id,
    name: rec.name,
    unit: rec.unit || 'kg',
    totalcount: rec.totalcount,
    delivered: rec.delivered,
    inprogress: rec.inprogress,
    pendingApproval: rec.pendingApproval,
    inProgressOrders: rec.inProgressOrders,
    fulfillment: rec.totalcount > 0 ? Math.min(100, Math.round((rec.delivered / rec.totalcount) * 100)) : 0
  }));

  // order_item_status: only commodities actually ordered
  const order_item_status = Array.from(itemMap.values()).map((rec) => ({
    id: rec.id,
    name: rec.name,
    unit: rec.unit || 'kg',
    totalcount: rec.totalcount,
    delivered: rec.delivered,
    inprogress: rec.inprogress,
    pendingApproval: rec.pendingApproval,
    inProgressOrders: rec.inProgressOrders,
    status: rec.pendingApproval > 0 && rec.delivered === 0 && rec.inprogress === 0
      ? 'Pending approval'
      : rec.delivered === rec.totalcount
      ? 'Delivered'
      : 'Active'
  }));

  // Shops by category breakdown
  const categoryCounts = {};
  for (const s of clusterShops) {
    const cat = s.shopCategory || s.shop_category || 'Retail';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }
  const shopsByCategory = Object.entries(categoryCounts).map(([category, count]) => ({ category, count }));

  return {
    totalshops,
    totalorderedshops,
    totalnotorderedshops,
    assignedShopsCount,
    visitedShopsCount,
    orderedShopsCount,
    deliverystatus,
    order_item_status,
    dailyDeliveryStatus,
    shopsByCategory
  };
}

// 2. GET /gethomereport
const handleGetHomeReport = async (req, res) => {
  await refreshStateFromDb();
  const reqSpersonId = req.query.spersonId || req.query.salespersonid;
  const scope = verifyFieldAgentScope(req, res, reqSpersonId);
  if (!scope.authorized) return;

  const { caller, effectiveSpersonId } = scope;
  const callerRole = (caller.role || 'Field Sales Agent').toLowerCase();
  if (
    !checkActionPermission(caller.role, 'view_all_reports') &&
    !checkActionPermission(caller.role, 'view_team_reports') &&
    !checkActionPermission(caller.role, 'view_agent_reports')
  ) {
    return res.status(403).json({
      status: 403,
      message: 'Permission Denied: Viewing reports has been disabled for your role by an Administrator.'
    });
  }

  const authorizedClusterIds = getAuthorizedClusterIds(caller);
  const filterClusterId = req.query.clusterId || req.query.clusterid;
  if (filterClusterId && filterClusterId !== 'all') {
    const requestedCid = Number(filterClusterId);
    if (callerRole !== 'admin' && !authorizedClusterIds.includes(requestedCid)) {
      return res.status(403).json({
        status: 403,
        message: `Access Denied: Cluster #${requestedCid} is outside your assigned scope.`
      });
    }
  }

  // Scoped orders (before date filter, so dailyDeliveryStatus can show previous days' In Progress orders too)
  let roleScopedOrders = submittedOrders;
  if (callerRole === 'admin') {
    if (reqSpersonId && reqSpersonId !== 'all') {
      roleScopedOrders = roleScopedOrders.filter((o) => Number(o.spersonid) === Number(reqSpersonId));
    }
  } else if (callerRole === 'sales manager') {
    const assigned = getAssignedAgentIds(caller.id);
    if (reqSpersonId && reqSpersonId !== 'all') {
      if (!assigned.includes(Number(reqSpersonId))) {
        return res.status(403).json({ status: 403, message: 'Access Denied: Agent is not in your team.' });
      }
      roleScopedOrders = roleScopedOrders.filter((o) => Number(o.spersonid) === Number(reqSpersonId));
    } else {
      roleScopedOrders = roleScopedOrders.filter(
        (o) => assigned.includes(Number(o.spersonid)) || authorizedClusterIds.includes(Number(o.clusterId))
      );
    }
  } else if (callerRole === 'field sales agent') {
    // Field Sales Agent: strictly only their own orders in their assigned clusters
    roleScopedOrders = roleScopedOrders.filter(
      (o) => Number(o.spersonid) === Number(effectiveSpersonId) && authorizedClusterIds.includes(Number(o.clusterId))
    );
  } else {
    roleScopedOrders = []; // T0.2: no other role has a report scope
  }

  // Resolve report period (today, 7d, 30d or custom fromDate/toDate in Asia/Kolkata)
  const hasPeriodOrDates = Boolean(req.query.period || req.query.range || req.query.fromDate || req.query.startDate || req.query.toDate || req.query.endDate);
  const periodInfo = resolveReportPeriodRange(req.query);
  const fromDate = hasPeriodOrDates ? periodInfo.fromDate : null;
  const toDate = hasPeriodOrDates ? periodInfo.toDate : null;

  let baseOrders = roleScopedOrders;
  if (fromDate) {
    baseOrders = baseOrders.filter((o) => (o.date || '').slice(0, 10) >= fromDate);
  }
  if (toDate) {
    baseOrders = baseOrders.filter((o) => (o.date || '').slice(0, 10) <= toDate);
  }

  // Scoped shops for stats (T0.2: explicit per role; nothing for other roles)
  let scopedShops = callerRole === 'admin' ? shops : [];
  if (callerRole === 'field sales agent') {
    scopedShops = shops.filter((s) => Number(s.assignedAgentId || s.assigned_agent_id) === Number(effectiveSpersonId));
  } else if (callerRole === 'sales manager') {
    const assigned = getAssignedAgentIds(caller.id);
    scopedShops = shops.filter((s) => {
      const assignedId = Number(s.assignedAgentId || s.assigned_agent_id || 0);
      const createdId = Number(s.createdby || s.created_by || 0);
      return assigned.includes(assignedId) || assigned.includes(createdId) || Number(s.clusterid) === Number(caller.clusterid);
    });
  }

  // Filter clusters
  let relevantClusters = clusters;
  if (callerRole !== 'admin') {
    relevantClusters = relevantClusters.filter((c) => authorizedClusterIds.includes(Number(c.clusterId)));
  }
  if (filterClusterId && filterClusterId !== 'all') {
    const matched = relevantClusters.filter((c) => Number(c.clusterId) === Number(filterClusterId));
    relevantClusters = matched;
  }

  const clusterList = relevantClusters.map((cluster) => {
    const stats = computeClusterStatsForScope(cluster.clusterId, baseOrders, scopedShops, roleScopedOrders);
    return {
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      deliverystatus: stats.deliverystatus,
      dailyDeliveryStatus: stats.dailyDeliveryStatus,
      order_shop_status: {
        totalshops: stats.totalshops,
        totalorderedshops: stats.totalorderedshops,
        totalnotorderedshops: stats.totalnotorderedshops,
        assignedShopsCount: stats.assignedShopsCount,
        visitedShopsCount: stats.visitedShopsCount,
        orderedShopsCount: stats.orderedShopsCount
      },
      order_item_status: stats.order_item_status,
      shopsByCategory: stats.shopsByCategory
    };
  });

  // Compute Target vs Actual summary for the caller/scope
  let matchedTargets = salesTargets;
  if (callerRole === 'field sales agent') {
    matchedTargets = salesTargets.filter((t) => Number(t.agentId) === Number(effectiveSpersonId));
  } else if (callerRole === 'sales manager') {
    const assignedFsaIds = getAssignedAgentIds(caller.id).filter((aid) => {
      const u = salesPersons.find((s) => Number(s.id) === Number(aid));
      return u && (u.role || '').toLowerCase() === 'field sales agent' && Number(u.active) === 1;
    });
    matchedTargets = salesTargets.filter((t) => assignedFsaIds.includes(Number(t.agentId)));
  } else if (reqSpersonId && reqSpersonId !== 'all') {
    matchedTargets = salesTargets.filter((t) => Number(t.agentId) === Number(reqSpersonId));
  }
  if (filterClusterId && filterClusterId !== 'all') {
    matchedTargets = matchedTargets.filter((t) => Number(t.clusterId) === Number(filterClusterId));
  }

  const targetAmount = matchedTargets.reduce((sum, t) => sum + Number(t.targetAmount || 0), 0);
  const actualAmount = baseOrders
    .filter((o) => String(o.status || '').toLowerCase() !== 'cancelled')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const differenceAmount = Number((actualAmount - targetAmount).toFixed(2));
  const achievementPct = targetAmount > 0 ? Number(((actualAmount / targetAmount) * 100).toFixed(1)) : 0;
  const perfIndicator = getPerformanceIndicator(achievementPct, targetAmount > 0);

  // Item-level Target vs Actual rows
  const itemTargetMap = new Map();
  matchedTargets.forEach((t) => {
    (t.itemTargets || []).forEach((it) => {
      const id = Number(it.itemId);
      if (!itemTargetMap.has(id)) {
        itemTargetMap.set(id, {
          itemId: id,
          itemName: it.itemName || `Item ${id}`,
          targetQty: 0,
          targetAmount: 0
        });
      }
      const cur = itemTargetMap.get(id);
      cur.targetQty += Number(it.targetQty || 0);
      cur.targetAmount += Number(it.targetAmount || 0);
    });
  });

  const itemActualMap = new Map();
  baseOrders
    .filter((o) => String(o.status || '').toLowerCase() !== 'cancelled')
    .forEach((o) => {
      (o.orderList || []).forEach((line) => {
        const id = Number(line.itemid || line.itemId || 0);
        const qty = parseFloat(line.qty) || 0;
        if (id <= 0 || qty <= 0) return;
        const price = parseFloat(line.price || line.custprice || line.actprice || 0);
        if (!itemActualMap.has(id)) {
          itemActualMap.set(id, {
            itemId: id,
            itemName: line.itemName || `Item ${id}`,
            actualQty: 0,
            actualAmount: 0
          });
        }
        const cur = itemActualMap.get(id);
        cur.actualQty += qty;
        cur.actualAmount += qty * price;
      });
    });

  const allItemIds = new Set([...itemTargetMap.keys(), ...itemActualMap.keys()]);
  const targetVsActualItems = Array.from(allItemIds).map((id) => {
    const t = itemTargetMap.get(id) || { itemId: id, itemName: `Item ${id}`, targetQty: 0, targetAmount: 0 };
    const a = itemActualMap.get(id) || { itemId: id, itemName: t.itemName, actualQty: 0, actualAmount: 0 };
    const hasTgt = t.targetAmount > 0 || t.targetQty > 0;
    const achPct = t.targetAmount > 0
      ? Number(((a.actualAmount / t.targetAmount) * 100).toFixed(1))
      : (t.targetQty > 0 ? Number(((a.actualQty / t.targetQty) * 100).toFixed(1)) : 0);
    return {
      itemId: id,
      itemName: a.itemName || t.itemName,
      unit: 'kg',
      targetQty: Number(t.targetQty.toFixed(2)),
      actualQty: Number(a.actualQty.toFixed(2)),
      differenceQty: Number((a.actualQty - t.targetQty).toFixed(2)),
      targetAmount: Number(t.targetAmount.toFixed(2)),
      actualAmount: Number(a.actualAmount.toFixed(2)),
      differenceAmount: Number((a.actualAmount - t.targetAmount).toFixed(2)),
      achievementPct: achPct,
      performanceIndicator: getPerformanceIndicator(achPct, hasTgt)
    };
  });

  // Total shop counts across relevantClusters
  const totalAssignedShops = clusterList.reduce((s, c) => s + (c.order_shop_status?.assignedShopsCount || 0), 0);
  const totalVisitedShops = clusterList.reduce((s, c) => s + (c.order_shop_status?.visitedShopsCount || 0), 0);
  const totalOrderedShops = clusterList.reduce((s, c) => s + (c.order_shop_status?.orderedShopsCount || 0), 0);

  // Frequently ordered customers: STRICTLY for Sales Manager / Admin only, never sent to Field Sales Agent
  const includeFreqCustomers = callerRole === 'sales manager' || callerRole === 'admin';
  const frequentlyOrderedCustomers = includeFreqCustomers
    ? computeFrequentlyOrderedCustomers(baseOrders, scopedShops, periodInfo)
    : undefined;

  res.json({
    status: 200,
    message: 'Data Received Successfully.',
    result: {
      status: 200,
      message: 'Details',
      salesPersonId: String(effectiveSpersonId),
      timezone: 'Asia/Kolkata',
      periodInfo,
      shopCounts: {
        assignedShopsCount: totalAssignedShops,
        visitedShopsCount: totalVisitedShops,
        orderedShopsCount: totalOrderedShops,
        notOrderedShopsCount: Math.max(0, totalAssignedShops - totalOrderedShops)
      },
      targetVsActual: {
        hasTarget: targetAmount > 0,
        targetAmount: Number(targetAmount.toFixed(2)),
        actualAmount: Number(actualAmount.toFixed(2)),
        differenceAmount,
        gapAmount: Math.max(0, Number((targetAmount - actualAmount).toFixed(2))),
        achievementPct,
        performanceIndicator: perfIndicator,
        items: targetVsActualItems
      },
      performanceIndicatorScale: PERFORMANCE_INDICATOR_SCALE,
      ...(includeFreqCustomers ? { frequentlyOrderedCustomers } : {}),
      clusterList
    }
  });
};

app.get('/gethomereport', handleGetHomeReport);
app.get('/api/linecart/gethomereport', handleGetHomeReport);
app.get('/admin_panel/public/api/linecart/gethomereport', handleGetHomeReport);

// 3. GET /clusterinfo
const handleClusterInfo = async (req, res) => {
  await refreshStateFromDb();
  const reqSpersonId = req.query.spersonId || req.query.salespersonid;
  const scope = verifyFieldAgentScope(req, res, reqSpersonId);
  if (!scope.authorized) return;

  const { caller, effectiveSpersonId } = scope;
  const callerRole = (caller.role || 'Field Sales Agent').toLowerCase();
  if (
    !checkActionPermission(caller.role, 'view_assigned_shops') &&
    !checkActionPermission(caller.role, 'view_cluster_shops') &&
    !checkActionPermission(caller.role, 'view_shops')
  ) {
    return res.status(403).json({
      status: 403,
      message: 'Permission Denied: Viewing cluster information has been disabled for your role by an Administrator.'
    });
  }

  let scopedClusters = callerRole === 'admin' ? clusters : []; // T0.2: explicit per role
  if (callerRole === 'field sales agent') {
    const assignedShops = shops.filter((s) => {
      const aid = s.assignedAgentId !== undefined && s.assignedAgentId !== null
        ? Number(s.assignedAgentId)
        : (s.assigned_agent_id !== undefined && s.assigned_agent_id !== null ? Number(s.assigned_agent_id) : null);
      return aid !== null && aid > 0 && aid === Number(effectiveSpersonId);
    });
    const assignedClusterIds = new Set(assignedShops.map((s) => Number(s.clusterid || s.cluster_id)));
    scopedClusters = clusters.filter((c) => assignedClusterIds.has(Number(c.clusterId)));
  } else if (callerRole === 'sales manager') {
    const authCids = new Set(getAuthorizedClusterIds(caller));
    scopedClusters = clusters.filter((c) => authCids.has(Number(c.clusterId)));
  }

  res.json({
    status: 200,
    message: 'Data Received Successfully.',
    result: {
      salesPersonId: String(effectiveSpersonId),
      clusterList: scopedClusters
    }
  });
};

app.get('/clusterinfo', handleClusterInfo);
app.get('/api/linecart/clusterinfo', handleClusterInfo);
app.get('/admin_panel/public/api/linecart/clusterinfo', handleClusterInfo);

// 4. POST /addcustomer (with durable, validated photo upload to server/uploads/shops/)
const handleAddCustomer = async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({
        status: 401,
        message: 'Authentication required: valid Bearer session token must be provided.'
      });
    }

    const callerRole = caller.role || 'Field Sales Agent';
    if (!checkActionPermission(callerRole, 'add_customer')) {
      return res.status(403).json({
        status: 403,
        message: 'Permission Denied: Registering customers has been disabled for your role by an Administrator.'
      });
    }

    let customerData = {};
    if (req.body && req.body.customer) {
      customerData =
        typeof req.body.customer === 'string'
          ? JSON.parse(req.body.customer)
          : req.body.customer;
    } else if (req.body) {
      customerData = req.body;
    }

    // Enforce creator ownership: Field Sales Agents cannot impersonate another agent ID
    if (
      (callerRole || '').toLowerCase() === 'field sales agent' &&
      customerData.createdby !== undefined &&
      Number(customerData.createdby) !== Number(caller.id)
    ) {
      return res.status(403).json({
        status: 403,
        message: 'Access Denied: Field Sales Agents cannot register customers under another agent ID.'
      });
    }

    const shopName = String(customerData.shopName || '').trim();
    if (!shopName) {
      return res.status(400).json({
        status: 400,
        message: 'Shop Name is required.',
        id: '0'
      });
    }

    // Validate optional uploaded shop photo
    const uploadedFile = (Array.isArray(req.files) && req.files.length > 0) ? req.files[0] : req.file;
    let photoValidation = null;
    if (uploadedFile) {
      photoValidation = validateShopPhotoUpload(uploadedFile);
      if (!photoValidation.valid) {
        return res.status(400).json({
          status: 400,
          message: photoValidation.message,
          id: '0'
        });
      }
    }

    const clusterid = parseInt(customerData.clusterid, 10) || Number(caller.clusterid || 1);
    const createdby = (callerRole || '').toLowerCase() === 'admin' && customerData.createdby
      ? parseInt(customerData.createdby, 10)
      : Number(caller.id);

    let savedShopId = 0;
    let savedPhotoName = 'no_image.jpg';

    await db.withTransaction(async (tx) => {
      await db.lockAllocation(tx, 'shops');
      const maxRes = await tx.query('SELECT COALESCE(MAX(shop_id), 400) + 1 AS next_id FROM shops');
      savedShopId = Number(maxRes.rows[0]?.next_id || 401);

      if (uploadedFile && photoValidation?.valid) {
        savedPhotoName = `shop_${savedShopId}_${crypto.randomUUID()}.${photoValidation.ext}`;
        await saveShopPhoto(savedPhotoName, uploadedFile.buffer, uploadedFile.mimetype || 'image/jpeg');
      }

      const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const surveyArr = Array.isArray(customerData.survey) ? customerData.survey : [];
      const assignedAgentId = (callerRole || '').toLowerCase() === 'field sales agent'
        ? Number(caller.id)
        : (customerData.assignedAgentId ? Number(customerData.assignedAgentId) : null);

      await tx.query(
        `INSERT INTO shops (shop_id, cluster_id, shop_name, shop_category, owner_name, contact1, contact2, latitude, longitude, address, pincode, payment_mode, created_by, assigned_agent_id, photo, active, created_on, survey_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, $16, $17)`,
        [
          savedShopId,
          clusterid,
          shopName,
          String(customerData.shopCategory || 'Vegitable Shop'),
          String(customerData.ownerName || ''),
          String(customerData.contact1 || ''),
          String(customerData.contact2 || ''),
          parseFloat(customerData.latitude) || 0,
          parseFloat(customerData.longitude) || 0,
          String(customerData.address || ''),
          String(customerData.pincode || ''),
          parseInt(customerData.paymentmode, 10) || 0,
          createdby,
          assignedAgentId,
          savedPhotoName,
          nowStr,
          JSON.stringify(surveyArr)
        ]
      );
    });

    await refreshStateFromDb();
    await addAuditLog(req, 'CUSTOMER_CREATE', 'Shop', savedShopId, `Registered shop '${shopName}' in Cluster #${clusterid}`);

    res.json({
      status: 200,
      message: 'Customer Created Successfully',
      id: String(savedShopId),
      photo: savedPhotoName !== 'no_image.jpg' ? `/api/uploads/shops/${savedPhotoName}` : null
    });
  } catch (err) {
    console.error('[AddCustomer Error]', err.message);
    const isStorageError = err.message.includes('photo storage') || err.message.includes('Remote photo');
    res.status(isStorageError ? 502 : 400).json({
      status: isStorageError ? 502 : 400,
      message: isStorageError ? `Failed to create customer: ${err.message}` : 'Failed To Create Customer',
      id: '0'
    });
  }
};

app.post('/addcustomer', upload.any(), handleAddCustomer);
app.post('/api/linecart/addcustomer', upload.any(), handleAddCustomer);
app.post('/admin_panel/public/api/linecart/addcustomer', upload.any(), handleAddCustomer);

// Authenticated Shop Photo Retrieval Endpoint (never publicly exposed without session token)
app.get('/api/uploads/shops/:filename', requireAuth, async (req, res) => {
  const caller = getCaller(req);
  const callerRole = caller.role || '';
  if (
    !checkActionPermission(callerRole, 'view_assigned_shops') &&
    !checkActionPermission(callerRole, 'view_cluster_shops') &&
    !checkActionPermission(callerRole, 'view_shops') &&
    !checkActionPermission(callerRole, 'view_assigned_deliveries')
  ) {
    return res.status(403).json({
      status: 403,
      message: 'Permission Denied: Your role cannot access shop photos.'
    });
  }

  const safeName = path.basename(String(req.params.filename || ''));
  if (!safeName || !/^shop_\d+_[a-f0-9-]+\.(jpg|png|webp)$/i.test(safeName)) {
    return res.status(400).json({ status: 400, message: 'Invalid photo filename.' });
  }

  // T0.4 (R6): the photo belongs to the shop named in its file name; the caller must be allowed that shop
  await refreshStateFromDb();
  const photoShopId = Number(/^shop_(\d+)_/i.exec(safeName)[1]);
  const photoShop = shops.find((s) => Number(s.shopid) === photoShopId);
  if (!photoShop) {
    return res.status(404).json({ status: 404, message: 'Shop photo not found.' });
  }
  if (!canCallerAccessShop(caller, photoShop)) {
    return res.status(403).json({ status: 403, message: 'Access Denied: you cannot view photos of this shop.' });
  }

  const photo = await getShopPhoto(safeName);
  if (!photo) {
    return res.status(404).json({ status: 404, message: 'Shop photo not found.' });
  }

  const ext = path.extname(safeName).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.send(photo.buffer);
});

// 5. GET /getitemsorder
const handleGetItemsOrder = async (req, res) => {
  await refreshStateFromDb();
  const reqSpersonId = req.query.spersonId || req.query.salespersonid;
  const scope = verifyFieldAgentScope(req, res, reqSpersonId);
  if (!scope.authorized) return;

  const { caller, effectiveSpersonId } = scope;
  const callerRole = (caller.role || 'Field Sales Agent').toLowerCase();
  if (
    !checkActionPermission(caller.role, 'view_assigned_shops') &&
    !checkActionPermission(caller.role, 'view_cluster_shops') &&
    !checkActionPermission(caller.role, 'view_shops')
  ) {
    return res.status(403).json({
      status: 403,
      message: 'Permission Denied: Accessing items order catalog has been disabled for your role by an Administrator.'
    });
  }

  const reqClusterId = req.query.clusterid || req.query.clusterId;
  if (reqClusterId && reqClusterId !== 'all' && callerRole !== 'admin') {
    const authCids = getAuthorizedClusterIds(caller);
    if (!authCids.includes(Number(reqClusterId))) {
      return res.status(403).json({
        status: 403,
        message: `Access Denied: Cluster #${reqClusterId} is outside your assigned scope.`
      });
    }
  }

  const activeCatalog = orderItemsCatalog.length > 0
    ? orderItemsCatalog.filter((item) => Number(item.active ?? 1) === 1)
    : defaultOrderItems;

  let scopedShops = callerRole === 'admin' ? shops : []; // T0.2: explicit per role
  if (callerRole === 'field sales agent') {
    scopedShops = shops.filter((s) => {
      const aid = s.assignedAgentId !== undefined && s.assignedAgentId !== null
        ? Number(s.assignedAgentId)
        : (s.assigned_agent_id !== undefined && s.assigned_agent_id !== null ? Number(s.assigned_agent_id) : null);
      return aid !== null && aid > 0 && aid === Number(effectiveSpersonId);
    });
  } else if (callerRole === 'sales manager') {
    const assignedAgentIds = getAssignedAgentIds(caller.id);
    scopedShops = shops.filter((s) => {
      const assignedId = Number(s.assignedAgentId || s.assigned_agent_id || 0);
      const createdId = Number(s.createdby || s.created_by || 0);
      return assignedAgentIds.includes(assignedId) ||
             assignedAgentIds.includes(createdId) ||
             Number(s.clusterid) === Number(caller.clusterid);
    });
  }

  const clusterList = clusters
    .map((cluster) => {
      const clusterItems = activeCatalog.map((item) => {
        const itemId = Number(item.itemId || item.itemid);
        const clusterPriceRow = clusterItemPrices.find(
          (cip) => Number(cip.clusterId) === Number(cluster.clusterId) && Number(cip.itemId) === itemId
        );
        const effectivePrice = clusterPriceRow ? Number(clusterPriceRow.price) : Number(item.price);
        return {
          itemid: itemId,
          itemId: itemId,
          itemName: item.itemName,
          itemimage: item.itemImage || item.itemimage || '',
          qty: Number(item.qty || 0),
          price: effectivePrice,
          cprice: Number(item.cprice || 0),
          kgsperunit: Number(item.kgsPerUnit || item.kgsperunit || 50),
          remarks: Number(item.remarks || 0),
          unitType: item.unitType || 'Kgs',
          clusterId: cluster.clusterId,
          active: Number(item.active ?? 1),
          updatedAt: clusterPriceRow ? clusterPriceRow.updatedAt : item.updatedAt
        };
      });

      const clusterShops = scopedShops
        .filter((s) => Number(s.clusterid) === Number(cluster.clusterId))
        .map((shop) => ({
          ...shop,
          itemsList: clusterItems
        }));

      return {
        clusterId: cluster.clusterId,
        clusterName: cluster.clusterName,
        shopsList: clusterShops
      };
    })
    .filter((c) => {
      if (callerRole === 'field sales agent') {
        return c.shopsList.length > 0;
      }
      return true;
    });

  res.json({
    status: 200,
    message: 'Data Received Successfully.',
    result: {
      status: 200,
      message: 'Details',
      salesPersonId: String(effectiveSpersonId),
      clusterList
    }
  });
};

app.get('/getitemsorder', handleGetItemsOrder);
app.get('/api/linecart/getitemsorder', handleGetItemsOrder);
app.get('/admin_panel/public/api/linecart/getitemsorder', handleGetItemsOrder);

// 6. POST /createorder (Transactional with concurrent serial_no & idempotency protection)
const handleCreateOrder = async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({
        status: 401,
        message: 'Authentication required: valid Bearer session token must be provided.'
      });
    }

    // Optional cut-off for app versions that could queue orders offline (switch on after the new APK is rolled out)
    const minClientLevel = Number(process.env.MIN_ORDER_CLIENT_LEVEL || 0);
    if (minClientLevel > 0 && Number(req.headers['x-linecart-client'] || 0) < minClientLevel) {
      return res.status(426).json({
        status: 426,
        message: 'Please update the LineCart app to place orders. This version is no longer supported for ordering.',
        id: '0'
      });
    }

    const callerRole = caller.role || 'Field Sales Agent';
    if (!checkActionPermission(callerRole, 'create_order')) {
      return res.status(403).json({
        status: 403,
        message: 'Permission Denied: Order creation has been disabled for your role by an Administrator.'
      });
    }

    const orderList = Array.isArray(req.body?.orderList) ? req.body.orderList : [];
    if (orderList.length === 0) {
      return res.status(400).json({
        status: 400,
        message: 'orderList cannot be empty.',
        id: '0'
      });
    }

    const activeItems = orderList.filter((item) => (parseFloat(item.qty) || 0) > 0);
    if (activeItems.length === 0) {
      return res.status(400).json({
        status: 400,
        message: 'Order must contain at least one item with quantity greater than zero.',
        id: '0'
      });
    }

    // Field Sales Agents are always attributed to their authenticated session user (caller.id).
    // Client-supplied spersonid values are ignored so stale caches or modified payloads can neither
    // trigger false mismatches nor attribute orders to another salesperson.
    const isFieldAgent = (callerRole || '').toLowerCase() === 'field sales agent';
    const requestedSpersonId = isFieldAgent
      ? Number(caller.id)
      : (orderList[0]?.spersonid !== undefined ? Number(orderList[0].spersonid) : Number(caller.id));
    if ((callerRole || '').toLowerCase() === 'sales manager') {
      const assigned = getAssignedAgentIds(caller.id);
      if (requestedSpersonId !== Number(caller.id) && !assigned.includes(requestedSpersonId)) {
        return res.status(403).json({
          status: 403,
          message: `Access Denied: Agent #${requestedSpersonId} is not assigned to your team.`
        });
      }
    }

    const credited = findCreditableSalesperson(requestedSpersonId);
    if (!credited.ok) {
      return res.status(400).json({
        status: 400,
        code: 'INVALID_CREDITED_SALESPERSON',
        message: `The order cannot be credited to user #${requestedSpersonId}: the user ${credited.reason}.`,
        id: '0'
      });
    }

    const customerId = Number(orderList[0]?.customerid || 0);
    const shop = shops.find((s) => Number(s.shopid) === customerId);
    if (!shop) {
      return res.status(404).json({
        status: 404,
        message: `Shop not found with ID ${customerId}.`,
        id: '0'
      });
    }
    if (!canCallerAccessShop(caller, shop)) {
      return res.status(403).json({
        status: 403,
        message: `Access Denied: You cannot create orders for shop #${shop.shopid} (${shop.shopName}) as it is not assigned to you.`,
        id: '0'
      });
    }
    const shopShortId = `S${String(shop.shopid).padStart(3, '0')}`;
    const explicitClusterId = orderList[0]?.clusterid !== undefined && orderList[0]?.clusterid !== null && orderList[0]?.clusterid !== ''
      ? parseInt(orderList[0].clusterid, 10)
      : null;
    if ((callerRole || '').toLowerCase() === 'field sales agent' && explicitClusterId !== null) {
      const authorizedClusters = getAuthorizedClusterIds(caller);
      if (!authorizedClusters.includes(explicitClusterId) || explicitClusterId !== Number(shop.clusterid)) {
        return res.status(403).json({
          status: 403,
          message: `Access Denied: You cannot submit orders for unassigned cluster #${explicitClusterId}.`,
          id: '0'
        });
      }
    }
    const clusterid = Number(shop?.clusterid || explicitClusterId || caller.clusterid || 1);
    const spersonid = requestedSpersonId;
    const agent = salesPersons.find((s) => Number(s.id) === Number(spersonid));

    // Official price for an item, resolved ONLY from server state (never from client-sent price fields):
    // cluster-specific daily price -> catalog base price -> default seed catalog.
    // Returns null when the item is unknown, archived, or has no positive price.
    const resolveServerPrice = (item, clusterId) => {
      const itemId = Number(item.itemid || item.itemId || 0);
      if (!Number.isInteger(itemId) || itemId <= 0) return null;
      const catalogItem = orderItemsCatalog.find((d) => Number(d.itemId || d.itemid) === itemId);
      if (catalogItem && Number(catalogItem.active ?? 1) !== 1) return null;
      const clusterPriceRow = clusterItemPrices.find(
        (cip) => Number(cip.clusterId) === Number(clusterId) && Number(cip.itemId) === itemId
      );
      if (clusterPriceRow && Number(clusterPriceRow.price) > 0) {
        return Number(clusterPriceRow.price);
      }
      if (catalogItem) {
        return Number(catalogItem.price) > 0 ? Number(catalogItem.price) : null;
      }
      if (orderItemsCatalog.length === 0) {
        const defaultItem = defaultOrderItems.find((d) => Number(d.itemid || d.itemId) === itemId);
        if (defaultItem && Number(defaultItem.price) > 0) return Number(defaultItem.price);
      }
      return null;
    };

    // Every line with a quantity must be a valid, priced catalog item
    const resolvedPrices = new Map();
    for (const item of activeItems) {
      const qtyNum = Number(item.qty);
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        return res.status(400).json({ status: 400, message: `Invalid quantity for item '${item.itemName || item.itemid}'.`, id: '0' });
      }
      const serverPrice = resolveServerPrice(item, clusterid);
      if (serverPrice === null) {
        return res.status(400).json({
          status: 400,
          message: `Item '${item.itemName || item.itemid}' is not available for ordering in this cluster. Refresh the catalog and try again.`,
          id: '0'
        });
      }
      resolvedPrices.set(item, serverPrice);
    }
    const resolveCatalogPrice = (item) => resolvedPrices.get(item);

    // Validate requested prices and identify if price approval is pending
    let hasPriceRequest = false;
    for (const item of activeItems) {
      const hasReq = item.requestedPrice !== undefined && item.requestedPrice !== null && item.requestedPrice !== '';
      if (hasReq) {
        const reqPrice = Number(item.requestedPrice);
        if (!Number.isFinite(reqPrice) || reqPrice < 0) {
          return res.status(400).json({
            status: 400,
            message: `Invalid requested price for item '${item.itemName || item.itemid}'. Price must be a non-negative number.`,
            id: '0'
          });
        }
        const catPrice = resolveCatalogPrice(item, clusterid);
        if (Math.abs(reqPrice - catPrice) > 0.001) {
          hasPriceRequest = true;
        }
      }
    }

    const initialOrderStatus = hasPriceRequest ? 'Price approval pending' : 'In progress';

    // Order total strictly uses catalog prices when placing the order (customer-requested price does not change catalog price, line totals, or order total until approved)
    const orderTotal = Number(
      activeItems.reduce(
        (sum, item) => sum + ((parseFloat(item.qty) || 0) * resolveCatalogPrice(item, clusterid)),
        0
      ).toFixed(2)
    );

    // Extract optional location and visit photo metadata from request body or first line item
    const firstItem = orderList[0] || {};
    const rawLat = req.body?.locationLat ?? req.body?.latitude ?? firstItem.locationLat ?? firstItem.latitude;
    const rawLng = req.body?.locationLng ?? req.body?.longitude ?? firstItem.locationLng ?? firstItem.longitude;
    const rawAcc = req.body?.locationAccuracy ?? firstItem.locationAccuracy;
    const locationLat = rawLat !== undefined && rawLat !== null && rawLat !== '' && !isNaN(Number(rawLat)) ? Number(rawLat) : null;
    const locationLng = rawLng !== undefined && rawLng !== null && rawLng !== '' && !isNaN(Number(rawLng)) ? Number(rawLng) : null;
    const locationAccuracy = rawAcc !== undefined && rawAcc !== null && rawAcc !== '' && !isNaN(Number(rawAcc)) ? Number(rawAcc) : null;
    const rawLocText = String(req.body?.locationText || firstItem.locationText || '').trim();
    const locationText = rawLocText || (locationLat !== null && locationLng !== null ? `${locationLat.toFixed(6)}, ${locationLng.toFixed(6)}` : null);

    const rawVisitPhoto = req.body?.visitPhoto ?? firstItem.visitPhoto ?? null;
    const visitPhoto = typeof rawVisitPhoto === 'string' && rawVisitPhoto.trim().length > 0 ? rawVisitPhoto.trim() : null;
    const visitPhotoStatus = visitPhoto ? 'synced' : null;

    const idempotencyKey = String(
      req.headers['x-idempotency-key'] || req.body?.idempotencyKey || ''
    ).trim() || null;
    const deviceEventTime = req.headers['x-device-event-time'] || req.body?.deviceEventTime || null;

    let resultPayload = null;

    await db.withTransaction(async (tx) => {
      // 0. Serialise order creation: makes the idempotency/duplicate checks and the
      //    MAX()+1 serial and line-id allocation safe under concurrent requests (PostgreSQL).
      await db.lockAllocation(tx, 'orders');
      await db.lockAllocation(tx, 'order_items');

      // 1. Check explicit idempotency key
      if (idempotencyKey) {
        const existingIdemp = await tx.query(
          'SELECT order_id, serial_no, shop_short_id, status, expected_delivery_date, visit_photo_status, location_text, total FROM orders WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        if (existingIdemp.rowCount > 0) {
          const row = existingIdemp.rows[0];
          resultPayload = {
            status: 200,
            message: 'Order Created Successfully',
            id: String(row.serial_no),
            orderId: row.order_id,
            shopId: row.shop_short_id,
            statusName: row.status,
            expectedDeliveryDate: row.expected_delivery_date || null,
            visitPhotoStatus: row.visit_photo_status || null,
            locationText: row.location_text || null,
            orderTotal: Number(row.total || orderTotal),
            priceApprovalPending: row.status === 'Price approval pending',
            idempotentReplay: true,
            deviceEventTime
          };
          return;
        }
      }

      // 2. Keyless clients only: treat a near-identical submission within 5 seconds as a double tap.
      //    Requests with an idempotency key are de-duplicated by the key alone, so two genuine orders
      //    with the same total are never merged.
      const fiveSecAgoIso = new Date(Date.now() - 5000).toISOString();
      const recentDup = idempotencyKey ? { rowCount: 0, rows: [] } : await tx.query(
        `SELECT order_id, serial_no, shop_short_id, status, expected_delivery_date, visit_photo_status, location_text, total
         FROM orders
         WHERE customer_id = $1 AND sperson_id = $2 AND total = $3 AND items_count = $4 AND created_at >= $5
         ORDER BY serial_no DESC LIMIT 1`,
        [shop ? shop.shopid : customerId, spersonid, orderTotal, activeItems.length, fiveSecAgoIso]
      );
      if (recentDup.rowCount > 0) {
        const row = recentDup.rows[0];
        resultPayload = {
          status: 200,
          message: 'Order Created Successfully',
          id: String(row.serial_no),
          orderId: row.order_id,
          shopId: row.shop_short_id,
          statusName: row.status,
          expectedDeliveryDate: row.expected_delivery_date || null,
          visitPhotoStatus: row.visit_photo_status || null,
          locationText: row.location_text || null,
          orderTotal: Number(row.total || orderTotal),
          priceApprovalPending: row.status === 'Price approval pending',
          idempotentReplay: true
        };
        return;
      }

      // 3. Allocate next serial_no atomically inside transaction
      const serialRes = await tx.query('SELECT COALESCE(MAX(serial_no), 24018) + 1 AS next_serial FROM orders');
      const nextSerial = Number(serialRes.rows[0]?.next_serial || 24019);
      const newOrderId = `${shopShortId}-${nextSerial}`;
      const nowIso = new Date().toISOString();
      const customDate = String(req.body?.orderDate || orderList[0]?.date || '').trim();
      const todayDate = /^\d{4}-\d{2}-\d{2}$/.test(customDate) ? customDate : getIstDateString();
      const explicitExpectedDate = String(req.body?.expectedDeliveryDate || firstItem.expectedDeliveryDate || '').trim();
      const expectedDeliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(explicitExpectedDate)
        ? explicitExpectedDate
        : addDaysToDateStr(todayDate, 1);

      // Assign default delivery agent in cluster if one exists
      const clusterDeliveryAgent = salesPersons.find(
        (u) => (u.role || '').toLowerCase() === 'delivery agent' && Number(u.active) === 1
      );
      const deliveryAgentId = clusterDeliveryAgent ? Number(clusterDeliveryAgent.id) : 50;

      await tx.query(
        `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name, cluster_id, order_date, expected_delivery_date, created_at, status, items_count, total, delivery_agent_id, idempotency_key, payment_status, payment_amount_collected, payment_balance_due, location_lat, location_lng, location_accuracy, location_text, visit_photo, visit_photo_status, visit_photo_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
        [
          newOrderId,
          nextSerial,
          shopShortId,
          shop ? shop.shopid : customerId,
          shop?.shopName || 'Customer Store',
          shop?.shopCategory || 'Retail',
          spersonid,
          agent?.name || `Agent ${spersonid}`,
          clusterid,
          todayDate,
          expectedDeliveryDate,
          nowIso,
          initialOrderStatus,
          activeItems.length,
          orderTotal,
          deliveryAgentId,
          idempotencyKey,
          'Not collected',
          0,
          orderTotal,
          locationLat,
          locationLng,
          locationAccuracy,
          locationText,
          visitPhoto,
          visitPhotoStatus,
          visitPhoto ? nowIso : null
        ]
      );

      const maxItemRes = await tx.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM order_items');
      let nextItemRowId = Number(maxItemRes.rows[0]?.max_id || 0);

      // Only lines with a quantity are stored (zero-quantity lines were never counted in items_count or totals)
      for (const item of activeItems) {
        nextItemRowId += 1;
        const hasReq = item.requestedPrice !== undefined && item.requestedPrice !== null && item.requestedPrice !== '';
        const reqPrice = hasReq ? Number(item.requestedPrice) : null;
        const catPrice = resolveCatalogPrice(item, clusterid);
        const isReq = hasReq && reqPrice !== null && !isNaN(reqPrice) && Math.abs(reqPrice - catPrice) > 0.001;
        const itemPriceStatus = isReq ? 'pending' : null;

        const catalogItemRef =
          orderItemsCatalog.find((d) => Number(d.itemId || d.itemid) === Number(item.itemid)) ||
          defaultOrderItems.find((d) => Number(d.itemid) === Number(item.itemid));
        const itemName = catalogItemRef?.itemName || item.itemName || `Item ${item.itemid}`;
        const unitType = catalogItemRef?.unitType || item.unitType || item.unit || 'kg';
        const enrichedLine = {
          ...item,
          spersonid,
          itemName,
          unitType,
          price: catPrice,
          custprice: catPrice,
          actprice: catPrice,
          catalogPrice: catPrice,
          requestedPrice: isReq ? reqPrice : undefined,
          priceRequestStatus: itemPriceStatus
        };

        await tx.query(
          `INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, requested_price, price_request_status, item_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            nextItemRowId,
            newOrderId,
            Number(item.itemid || 0),
            String(itemName),
            Number(item.qty || 0),
            catPrice,
            catPrice,
            catPrice,
            isReq ? reqPrice : null,
            itemPriceStatus,
            JSON.stringify(enrichedLine)
          ]
        );

        if (isReq) {
          const reqId = `pr-${nextSerial}-${item.itemid}`;
          const reqIdempotency = idempotencyKey ? `${idempotencyKey}_item_${item.itemid}` : null;
          await tx.query(
            `INSERT INTO price_requests (id, order_id, item_id, shop_id, cluster_id, agent_id, requested_price, catalog_price, reason, status, created_at, idempotency_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11)`,
            [
              reqId,
              newOrderId,
              Number(item.itemid || 0),
              shop ? shop.shopid : customerId,
              clusterid,
              spersonid,
              reqPrice,
              catPrice,
              String(item.reason || item.priceRequestReason || item.requestReason || ''),
              nowIso,
              reqIdempotency
            ]
          );
        }
      }

      resultPayload = {
        status: 200,
        message: hasPriceRequest ? 'Order Created (Price approval pending)' : 'Order Created Successfully',
        id: String(nextSerial),
        orderId: newOrderId,
        shopId: shopShortId,
        orderDate: todayDate,
        expectedDeliveryDate,
        orderTotal,
        locationLat,
        locationLng,
        locationAccuracy,
        locationText,
        visitPhotoStatus,
        statusName: initialOrderStatus,
        priceApprovalPending: hasPriceRequest
      };
    });

    await refreshStateFromDb();
    if (!resultPayload.idempotentReplay) {
      await addAuditLog(req, 'ORDER_CREATE', 'Order', resultPayload.orderId, `Created order ${resultPayload.orderId} for shop ${resultPayload.shopId} (₹${orderTotal})`);
    }

    res.json(resultPayload);
  } catch (err) {
    console.error('[CreateOrder Error]', err.message);
    res.status(400).json({
      status: 400,
      message: 'Failed to create Order.',
      id: '0'
    });
  }
};

app.post('/createorder', handleCreateOrder);
app.post('/api/linecart/createorder', handleCreateOrder);
app.post('/admin_panel/public/api/linecart/createorder', handleCreateOrder);

// 6a. GET /api/shops/:shopId/order-history (7-day past orders for a selected shop with historical unit prices)
const handleGetShopOrderHistory = async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({
        status: 401,
        message: 'Authentication required: valid Bearer session token must be provided.'
      });
    }

    const rawShopParam = String(req.params.shopId || '').trim();
    if (!rawShopParam) {
      return res.status(400).json({ status: 400, message: 'Shop ID is required.' });
    }

    const numericShopId = parseInt(rawShopParam.replace(/^S/i, ''), 10);
    const shopShortId = !isNaN(numericShopId) ? `S${String(numericShopId).padStart(3, '0')}` : rawShopParam;

    const shop = shops.find(
      (s) => Number(s.shopid) === numericShopId || String(s.shopid) === rawShopParam
    );

    if (!shop) {
      return res.status(404).json({
        status: 404,
        message: `Shop not found with ID ${rawShopParam}.`
      });
    }

    if (!canCallerAccessShop(caller, shop)) {
      return res.status(403).json({
        status: 403,
        message: `Access Denied: You do not have permission to view order history for shop #${shop.shopid} (${shop.shopName}).`
      });
    }

    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
    const now = new Date();
    const istDateString = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);

    const todayStr = (req.query.today && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today))
      ? req.query.today
      : istDateString;
    const todayDate = new Date(`${todayStr}T00:00:00Z`);
    const cutoffMs = todayDate.getTime() - (days - 1) * 86400000;
    const cutoffDateStr = new Date(cutoffMs).toISOString().slice(0, 10);

    const ordersRes = await db.query(
      `SELECT order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category,
              sperson_id, agent_name, cluster_id, order_date, expected_delivery_date, created_at, status, items_count, total,
              payment_status, payment_amount_collected, payment_balance_due, location_text, visit_photo_status
       FROM orders
       WHERE (customer_id = $1 OR shop_short_id = $2)
         AND SUBSTR(order_date, 1, 10) >= $3
         AND SUBSTR(order_date, 1, 10) <= $4
       ORDER BY order_date DESC, serial_no DESC`,
      [shop.shopid, shopShortId, cutoffDateStr, todayStr]
    );

    const orderRows = ordersRes.rows || [];
    const itemsByOrderId = new Map();

    if (orderRows.length > 0) {
      const orderIds = orderRows.map((r) => String(r.order_id));
      const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(', ');
      const itemsRes = await db.query(
        `SELECT id, order_id, item_id, item_name, qty, price, cust_price, act_price, requested_price, price_request_status, item_json
         FROM order_items
         WHERE order_id IN (${placeholders})
         ORDER BY id ASC`,
        orderIds
      );

      for (const itemRow of (itemsRes.rows || [])) {
        const oid = String(itemRow.order_id);
        if (!itemsByOrderId.has(oid)) itemsByOrderId.set(oid, []);

        let parsedJson = {};
        try {
          parsedJson = JSON.parse(itemRow.item_json || '{}');
        } catch {}

        const qty = Number(itemRow.qty || 0);
        const listPrice = Number(itemRow.price);
        const custPrice = Number(itemRow.cust_price);
        const unitPrice = (listPrice > 0) ? listPrice : (custPrice > 0 ? custPrice : 0);
        const lineTotal = Number((qty * unitPrice).toFixed(2));
        const rawUnit = parsedJson.unitType || parsedJson.unit || 'kg';
        const unit = String(rawUnit).toLowerCase().startsWith('kg') ? 'kg' : rawUnit;
        const reqPrice = itemRow.requested_price !== null && itemRow.requested_price !== undefined
          ? Number(itemRow.requested_price)
          : (parsedJson.requestedPrice !== undefined ? Number(parsedJson.requestedPrice) : null);
        const reqStatus = itemRow.price_request_status || parsedJson.priceRequestStatus || null;

        itemsByOrderId.get(oid).push({
          id: itemRow.id,
          itemId: Number(itemRow.item_id),
          name: itemRow.item_name,
          qty,
          unit,
          unitPrice,
          catalogPrice: Number(parsedJson.catalogPrice || listPrice || unitPrice),
          requestedPrice: reqPrice,
          priceRequestStatus: reqStatus,
          lineTotal
        });
      }
    }

    const formattedOrders = orderRows.map((o) => {
      const oid = String(o.order_id);
      const items = itemsByOrderId.get(oid) || [];
      const computedTotal = items.reduce((sum, it) => sum + it.lineTotal, 0);
      const orderTotal = Number(o.total || computedTotal);
      const dStr = String(o.order_date || '').slice(0, 10);
      const expDeliv = o.expected_delivery_date || (dStr ? addDaysToDateStr(dStr, 1) : null);

      return {
        orderId: o.order_id,
        serialNo: Number(o.serial_no || 0),
        orderNumber: String(o.serial_no || o.order_id),
        date: o.order_date,
        expectedDeliveryDate: expDeliv,
        createdAt: o.created_at,
        status: o.status || 'In progress',
        agentName: o.agent_name,
        total: orderTotal,
        locationText: o.location_text || null,
        visitPhotoStatus: o.visit_photo_status || null,
        paymentStatus: o.payment_status || 'Not collected',
        paymentAmountCollected: Number(o.payment_amount_collected || 0),
        paymentBalanceDue: Number(o.payment_balance_due !== undefined && o.payment_balance_due !== null ? o.payment_balance_due : orderTotal),
        itemsCount: items.length,
        items
      };
    });

    res.json({
      status: 200,
      shop: {
        shopId: shop.shopid,
        shopShortId,
        shopName: shop.shopName,
        shopCategory: shop.shopCategory || 'Retail',
        clusterId: shop.clusterid
      },
      period: {
        days,
        startDate: cutoffDateStr,
        endDate: todayStr,
        cutoffDate: cutoffDateStr,
        today: todayStr
      },
      ordersCount: formattedOrders.length,
      orders: formattedOrders
    });
  } catch (err) {
    console.error('[API Error] handleGetShopOrderHistory:', err.message);
    res.status(500).json({
      status: 500,
      message: 'Failed to retrieve shop order history.'
    });
  }
};

app.get('/api/shops/:shopId/order-history', requireAuth, handleGetShopOrderHistory);
app.get('/api/linecart/shops/:shopId/order-history', requireAuth, handleGetShopOrderHistory);

// 6b. PUT /api/shops/:shopId/assign (Assign, reassign or unassign shop - Admin & Sales Manager)
const handleAssignShopAgent = async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({ status: 401, message: 'Authentication required' });
    }

    const callerRole = (caller.role || '').toLowerCase();
    if (callerRole === 'field sales agent') {
      return res.status(403).json({
        status: 403,
        message: 'Permission Denied: Field Sales Agents cannot assign shops to agents or themselves.'
      });
    }

    if (callerRole !== 'admin' && callerRole !== 'sales manager') {
      return res.status(403).json({
        status: 403,
        message: 'Permission Denied: Only Admins and Sales Managers can assign shops to agents.'
      });
    }

    const rawShopParam = String(req.params.shopId || req.body?.shopId || '').trim();
    const numericShopId = parseInt(rawShopParam.replace(/^S/i, ''), 10);
    const shop = shops.find(
      (s) => Number(s.shopid) === numericShopId || String(s.shopid) === rawShopParam
    );

    if (!shop) {
      return res.status(404).json({ status: 404, message: `Shop not found with ID ${rawShopParam}` });
    }

    const isUnassign = req.body?.unassign === true ||
      req.body?.agentId === null ||
      req.body?.agentId === 0 ||
      req.body?.agentId === 'unassign' ||
      req.body?.assignedAgentId === null ||
      req.body?.assignedAgentId === 0 ||
      req.body?.assignedAgentId === 'unassign';

    const prevAgentId = (shop.assignedAgentId !== undefined && shop.assignedAgentId !== null)
      ? Number(shop.assignedAgentId)
      : ((shop.assigned_agent_id !== undefined && shop.assigned_agent_id !== null) ? Number(shop.assigned_agent_id) : null);
    const prevAgent = prevAgentId ? salesPersons.find((u) => Number(u.id) === Number(prevAgentId)) : null;

    if (isUnassign) {
      if (callerRole === 'sales manager') {
        const teamAgentIds = getAssignedAgentIds(caller.id);
        const currentCluster = Number(shop.clusterid || shop.cluster_id || 0);
        const managerCluster = Number(caller.clusterid || caller.cluster_id || 0);
        const hasAccess = (prevAgentId && teamAgentIds.includes(Number(prevAgentId))) ||
          (currentCluster > 0 && currentCluster === managerCluster);
        if (!hasAccess) {
          return res.status(403).json({
            status: 403,
            message: 'Access Denied: You can only unassign shops within your supervised team or cluster.'
          });
        }
      }

      await db.query('UPDATE shops SET assigned_agent_id = NULL WHERE shop_id = $1', [shop.shopid]);

      shop.assignedAgentId = null;
      shop.assigned_agent_id = null;

      await addAuditLog(
        req,
        'SHOP_UNASSIGNED',
        'Shop',
        shop.shopid,
        JSON.stringify({
          shopId: shop.shopid,
          shopName: shop.shopName,
          previousAgentId: prevAgentId,
          previousAgentName: prevAgent ? prevAgent.name : (prevAgentId ? `Agent #${prevAgentId}` : 'Unassigned'),
          reason: req.body?.reason || 'Shop assignment removed'
        })
      );

      return res.json({
        status: 200,
        message: `Shop #${shop.shopid} successfully unassigned.`,
        shop: {
          ...shop,
          assignedAgentId: null,
          assigned_agent_id: null,
          assignedAgentName: 'Unassigned'
        }
      });
    }

    const agentId = Number(req.body?.agentId || req.body?.agent_id || req.body?.assignedAgentId);
    if (!agentId || isNaN(agentId)) {
      return res.status(400).json({ status: 400, message: 'Valid agentId is required in request body.' });
    }

    const targetAgent = salesPersons.find((u) => Number(u.id) === agentId);
    if (!targetAgent) {
      return res.status(404).json({ status: 404, message: `Agent not found with ID ${agentId}` });
    }

    if ((targetAgent.role || '').toLowerCase() !== 'field sales agent') {
      return res.status(400).json({ status: 400, message: 'Target user must be a Field Sales Agent.' });
    }

    // Sales Managers can only assign shops to agents in their supervised team
    if (callerRole === 'sales manager') {
      const teamAgentIds = getAssignedAgentIds(caller.id);
      if (!teamAgentIds.includes(agentId)) {
        return res.status(403).json({
          status: 403,
          message: `Access Denied: Field Sales Agent #${agentId} (${targetAgent.name}) is not in your assigned team.`
        });
      }
    }

    // Update database
    await db.query('UPDATE shops SET assigned_agent_id = $1 WHERE shop_id = $2', [agentId, shop.shopid]);

    // Update in-memory state
    shop.assignedAgentId = agentId;
    shop.assigned_agent_id = agentId;

    await addAuditLog(
      req,
      'SHOP_ASSIGNED',
      'Shop',
      shop.shopid,
      JSON.stringify({
        shopId: shop.shopid,
        shopName: shop.shopName,
        previousAgentId: prevAgentId,
        previousAgentName: prevAgent ? prevAgent.name : (prevAgentId ? `Agent #${prevAgentId}` : 'Unassigned'),
        newAgentId: agentId,
        newAgentName: targetAgent.name,
        reason: req.body?.reason || 'Shop assignment updated'
      })
    );

    res.json({
      status: 200,
      message: `Shop #${shop.shopid} successfully assigned to ${targetAgent.name}.`,
      shop: {
        ...shop,
        assignedAgentId: agentId,
        assigned_agent_id: agentId,
        assignedAgentName: targetAgent.name
      }
    });
  } catch (err) {
    console.error('Error assigning shop agent:', err);
    res.status(500).json({ status: 500, message: 'Internal server error while assigning shop.' });
  }
};

// 6b2. POST /api/admin/shops/bulk-assign (Bulk assign, reassign or unassign shops with atomic transaction)
const handleBulkAssignShops = async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({ status: 401, message: 'Authentication required' });
    }

    const callerRole = (caller.role || '').toLowerCase();
    if (callerRole !== 'admin' && callerRole !== 'sales manager') {
      return res.status(403).json({
        status: 403,
        message: 'Permission Denied: Only Admins and Sales Managers can bulk assign shops.'
      });
    }

    const { shopIds, agentId, unassign, reason } = req.body || {};
    if (!Array.isArray(shopIds) || shopIds.length === 0) {
      return res.status(400).json({ status: 400, message: 'shopIds array is required and must not be empty.' });
    }

    const isUnassign = unassign === true || agentId === null || agentId === 0 || agentId === 'unassign';
    let targetAgent = null;
    let targetAgentId = null;

    if (!isUnassign) {
      targetAgentId = Number(agentId);
      if (!targetAgentId || isNaN(targetAgentId)) {
        return res.status(400).json({ status: 400, message: 'Valid agentId is required for bulk assignment.' });
      }
      targetAgent = salesPersons.find((u) => Number(u.id) === targetAgentId);
      if (!targetAgent) {
        return res.status(404).json({ status: 404, message: `Agent not found with ID ${targetAgentId}` });
      }
      if ((targetAgent.role || '').toLowerCase() !== 'field sales agent') {
        return res.status(400).json({ status: 400, message: 'Target user must be a Field Sales Agent.' });
      }
      if (callerRole === 'sales manager') {
        const teamAgentIds = getAssignedAgentIds(caller.id);
        if (!teamAgentIds.includes(targetAgentId)) {
          return res.status(403).json({
            status: 403,
            message: `Access Denied: Field Sales Agent #${targetAgentId} (${targetAgent.name}) is not in your assigned team.`
          });
        }
      }
    }

    // Validate EVERY selected shop first before applying any changes (atomic guarantee)
    const validShops = [];
    for (const rawId of shopIds) {
      const numericId = typeof rawId === 'string' ? parseInt(rawId.replace(/^S/i, ''), 10) : Number(rawId);
      const shop = shops.find((s) => Number(s.shopid) === numericId || String(s.shopid) === String(rawId));
      if (!shop) {
        return res.status(404).json({ status: 404, message: `Validation failed: Shop #${rawId} not found.` });
      }
      if (callerRole === 'sales manager') {
        const teamAgentIds = getAssignedAgentIds(caller.id);
        const currentAid = shop.assignedAgentId ?? shop.assigned_agent_id;
        const currentCluster = Number(shop.clusterid || shop.cluster_id || 0);
        const managerCluster = Number(caller.clusterid || caller.cluster_id || 0);
        const hasAccess = (currentAid && teamAgentIds.includes(Number(currentAid))) ||
          (currentCluster > 0 && currentCluster === managerCluster);
        if (!hasAccess) {
          return res.status(403).json({
            status: 403,
            message: `Access Denied: Shop #${shop.shopid} (${shop.shopName}) is outside your supervised team or cluster.`
          });
        }
      }
      validShops.push(shop);
    }

    const auditDetails = [];
    // Atomic execution inside transaction
    await db.withTransaction(async (tx) => {
      for (const shop of validShops) {
        const prevAgentId = (shop.assignedAgentId !== undefined && shop.assignedAgentId !== null)
          ? Number(shop.assignedAgentId)
          : ((shop.assigned_agent_id !== undefined && shop.assigned_agent_id !== null) ? Number(shop.assigned_agent_id) : null);
        const prevAgent = prevAgentId ? salesPersons.find((u) => Number(u.id) === Number(prevAgentId)) : null;

        await tx.query('UPDATE shops SET assigned_agent_id = $1 WHERE shop_id = $2', [
          targetAgentId,
          shop.shopid
        ]);

        auditDetails.push({
          shopId: shop.shopid,
          shopName: shop.shopName,
          previousAgentId: prevAgentId,
          previousAgentName: prevAgent ? prevAgent.name : (prevAgentId ? `Agent #${prevAgentId}` : 'Unassigned')
        });
      }
    });

    // Update in-memory state after successful transaction
    for (const shop of validShops) {
      shop.assignedAgentId = targetAgentId;
      shop.assigned_agent_id = targetAgentId;
    }

    const action = isUnassign ? 'SHOP_BULK_UNASSIGNED' : 'SHOP_BULK_ASSIGNED';
    await addAuditLog(
      req,
      action,
      'Shop',
      validShops.map((s) => s.shopid).join(','),
      JSON.stringify({
        action,
        newAgentId: targetAgentId,
        newAgentName: targetAgent ? targetAgent.name : null,
        affectedCount: validShops.length,
        reason: reason || (isUnassign ? 'Bulk shop unassignment' : 'Bulk shop assignment'),
        shops: auditDetails
      })
    );

    res.json({
      status: 200,
      message: isUnassign
        ? `Successfully unassigned ${validShops.length} shops.`
        : `Successfully assigned ${validShops.length} shops to ${targetAgent.name}.`,
      count: validShops.length,
      assignedAgentId: targetAgentId,
      assignedAgentName: targetAgent ? targetAgent.name : 'Unassigned',
      shopIds: validShops.map((s) => s.shopid)
    });
  } catch (err) {
    console.error('Error in handleBulkAssignShops:', err);
    res.status(500).json({ status: 500, message: 'Internal server error while bulk assigning shops.' });
  }
};

app.put('/api/shops/:shopId/assign', requireAuth, handleAssignShopAgent);
app.post('/api/shops/:shopId/assign-agent', requireAuth, handleAssignShopAgent);
app.post('/api/admin/shops/:shopId/assign', requireAuth, handleAssignShopAgent);
app.post('/api/admin/shops/bulk-assign', requireAuth, handleBulkAssignShops);

// 6c. GET /api/shops (List shops with role-based scoping)
app.get('/api/shops', requireAuth, async (req, res) => {
  await refreshStateFromDb();
  const caller = getCaller(req);
  if (!caller) return res.status(401).json({ status: 401, message: 'Authentication required' });

  const callerRole = (caller.role || '').toLowerCase();
  let scopedShops;

  if (callerRole === 'admin') {
    scopedShops = shops;
  } else if (callerRole === 'field sales agent') {
    scopedShops = shops.filter((s) => {
      const aid = s.assignedAgentId !== undefined && s.assignedAgentId !== null
        ? Number(s.assignedAgentId)
        : (s.assigned_agent_id !== undefined && s.assigned_agent_id !== null ? Number(s.assigned_agent_id) : null);
      return aid !== null && aid > 0 && aid === Number(caller.id);
    });
  } else if (callerRole === 'sales manager') {
    const teamAgentIds = getAssignedAgentIds(caller.id);
    scopedShops = shops.filter((s) => {
      const assignedId = Number(s.assignedAgentId || s.assigned_agent_id || 0);
      const createdId = Number(s.createdby || s.created_by || 0);
      return teamAgentIds.includes(assignedId) ||
             teamAgentIds.includes(createdId) ||
             Number(s.clusterid) === Number(caller.clusterid);
    });
  } else if (callerRole === 'delivery agent') {
    // R1 (T0.2/L7): was every shop; now only shops with a delivery assigned to the agent, open or closed
    const deliveryShopIds = getDeliveryAgentShopIds(caller.id);
    scopedShops = shops.filter((s) => deliveryShopIds.has(Number(s.shopid)));
  } else {
    return res.status(403).json({ status: 403, message: 'Access Denied: your role cannot list shops.' });
  }

  const userMap = new Map(salesPersons.map((u) => [Number(u.id), u.name]));
  const formatted = scopedShops.map((s) => {
    const rawAid = s.assignedAgentId !== undefined && s.assignedAgentId !== null
      ? s.assignedAgentId
      : (s.assigned_agent_id !== undefined && s.assigned_agent_id !== null ? s.assigned_agent_id : null);
    const aid = rawAid !== null && !isNaN(Number(rawAid)) && Number(rawAid) > 0 ? Number(rawAid) : null;
    return {
      ...s,
      assignedAgentId: aid,
      assigned_agent_id: aid,
      assignedAgentName: aid ? (userMap.get(aid) || `Agent #${aid}`) : 'Unassigned'
    };
  });

  res.json({
    status: 200,
    shops: formatted
  });
});

// ============================================================================
// ADMIN API ENDPOINTS (Full System Control & Governance, Persisted in SQL DB)
// ============================================================================

// Role Permissions Endpoint (Requires authentication; returns caller role permissions or full map for Admin)
app.get('/api/role-permissions', requireAuth, async (req, res) => {
  await refreshStateFromDb();
  const caller = getCaller(req);
  const isAdmin = (caller.role || '').toLowerCase() === 'admin';
  const scopedPermissions = isAdmin
    ? rolePermissions
    : { [caller.role]: rolePermissions[caller.role] || { pages: [], actions: [] } };

  res.json({
    status: 200,
    rolePermissions: scopedPermissions
  });
});

// 1. Admin Dashboard Metrics
app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const totalUsers = salesPersons.length;
  const activeUsers = salesPersons.filter((s) => Number(s.active) === 1).length;
  const managerCount = salesPersons.filter((s) => (s.role || '').toLowerCase() === 'sales manager').length;
  const agentCount = salesPersons.filter((s) => (s.role || '').toLowerCase() === 'field sales agent').length;
  const adminCount = salesPersons.filter((s) => (s.role || '').toLowerCase() === 'admin').length;

  const totalShops = shops.length;
  const totalClusters = clusters.length;
  const totalOrders = submittedOrders.length;
  const totalRevenue = submittedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalUnits = submittedOrders.reduce((sum, o) => {
    const u = (o.orderList || []).reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
    return sum + u;
  }, 0);
  const averageOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const clusterStatsBreakdown = clusters.map((c) => {
    const clusterShops = shops.filter((s) => Number(s.clusterid) === Number(c.clusterId));
    const clusterOrders = submittedOrders.filter((o) => Number(o.clusterId) === Number(c.clusterId));
    const revenue = clusterOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    return {
      clusterId: c.clusterId,
      clusterName: c.clusterName || `Cluster ${c.clusterId}`,
      shopCount: clusterShops.length,
      orderCount: clusterOrders.length,
      revenue
    };
  });

  const managers = salesPersons.filter((s) => (s.role || '').toLowerCase() === 'sales manager');
  const managerBreakdown = managers.map((m) => {
    const assignedIds = getAssignedAgentIds(m.id);
    const mOrders = submittedOrders.filter((o) => assignedIds.includes(Number(o.spersonid)));
    const revenue = mOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const mTargets = salesTargets.filter((t) => assignedIds.includes(Number(t.agentId)));
    const targetAmount = mTargets.reduce((sum, t) => sum + Number(t.targetAmount || 0), 0);
    const achievementRate = targetAmount > 0 ? Math.min(100, Math.round((revenue / targetAmount) * 100)) : 0;
    return {
      id: m.id,
      name: m.name,
      assignedAgentsCount: assignedIds.length,
      orderCount: mOrders.length,
      revenue,
      targetAmount,
      achievementRate
    };
  });

  res.json({
    status: 200,
    metrics: {
      totalUsers,
      activeUsers,
      managerCount,
      agentCount,
      adminCount,
      totalShops,
      totalClusters,
      totalOrders,
      totalRevenue,
      totalUnits,
      averageOrderValue
    },
    clusterStatsBreakdown,
    managerBreakdown,
    recentAudits: auditLogs.slice(0, 8),
    appSettings,
    invalidPhoneAccounts
  });
});

// 2. Admin User Management APIs
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const usersWithMeta = salesPersons.map((u) => {
    const uRole = (u.role || '').toLowerCase();
    let assignedManager = null;
    let assignedAgentsCount = 0;

    if (uRole === 'field sales agent') {
      const mEntry = Object.entries(managerAssignments).find(([_, agentIds]) => agentIds.includes(Number(u.id)));
      if (mEntry) {
        const mgr = salesPersons.find((s) => Number(s.id) === Number(mEntry[0]));
        assignedManager = mgr ? { id: mgr.id, name: mgr.name } : { id: Number(mEntry[0]), name: `Manager #${mEntry[0]}` };
      }
    } else if (uRole === 'sales manager') {
      assignedAgentsCount = (managerAssignments[u.id] || []).length;
    }

    return {
      id: u.id,
      name: u.name,
      role: u.role || 'Field Sales Agent',
      phone: u.phone || '',
      phoneValid: Boolean(u.phoneValid && isValidIndianMobile(u.phone)),
      requiresPhoneFix: !u.phoneValid || !isValidIndianMobile(u.phone),
      clusterid: u.clusterid,
      active: u.active !== undefined ? u.active : 1,
      createdon: u.createdon || '2026-04-01 09:00:00',
      mustChangePassword: Boolean(u.mustChangePassword),
      assignedManager,
      assignedAgentsCount
    };
  });

  res.json({
    status: 200,
    users: usersWithMeta,
    invalidPhoneAccounts: usersWithMeta.filter((u) => u.requiresPhoneFix)
  });
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const { name, phone, role, password, clusterid } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const rawPhone = typeof phone === 'string' ? phone : '';

  if (!trimmedName || !rawPhone) {
    return res.status(400).json({ status: 400, message: 'Name and a 10-digit Indian mobile number are required.' });
  }

  // Strict 10-digit Indian mobile validation (6, 7, 8, or 9 followed by 9 digits; no spaces or country codes)
  if (!isValidIndianMobile(rawPhone)) {
    return res.status(400).json({
      status: 400,
      message: 'Invalid mobile number: must be an Indian mobile number containing exactly 10 digits starting with 6, 7, 8, or 9 (no spaces, letters, or country codes).'
    });
  }

  const existing = salesPersons.find((s) => s.phone === rawPhone);
  if (existing) {
    return res.status(400).json({
      status: 400,
      message: `Mobile number ${rawPhone} is already registered to ${existing.name} (#${existing.id}).`
    });
  }

  const validRoles = STAFF_ROLES;
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({
      status: 400,
      message: `Invalid role '${role}'. Role must be one of: ${validRoles.join(', ')}`
    });
  }
  const assignedRole = role || 'Field Sales Agent';

  const initialPassword = password ? String(password) : `Lc#${crypto.randomBytes(4).toString('hex')}9!`;
  if (initialPassword.length < 8) {
    return res.status(400).json({ status: 400, message: 'Password must be at least 8 characters long.' });
  }
  if (isKnownDemoPassword(initialPassword)) {
    return res.status(400).json({
      status: 400,
      message: 'Security Policy: Known demo or weak default passwords cannot be used.'
    });
  }

  const passwordHash = hashPassword(initialPassword);
  const createdOn = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let nextId = 0;

  await db.withTransaction(async (tx) => {
    await db.lockAllocation(tx, 'users');
    const idRes = await tx.query('SELECT COALESCE(MAX(id), 100) + 1 AS next_id FROM users');
    nextId = Math.max(Number(idRes.rows[0]?.next_id || 101), 101);
    const mustChangeVal = (req.body && req.body.mustChangePassword !== undefined)
      ? (req.body.mustChangePassword ? 1 : 0)
      : 1;

    await tx.query(
      `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, 1, $8)`,
      [nextId, trimmedName, assignedRole, rawPhone, passwordHash, mustChangeVal, Number(clusterid || 1), createdOn]
    );
  });

  await refreshStateFromDb();
  await addAuditLog(req, 'USER_CREATE', 'User', nextId, `Created ${assignedRole} '${trimmedName}' (Phone: ${rawPhone})`);

  const createdUser = salesPersons.find((s) => Number(s.id) === nextId);
  const safeUser = { ...createdUser };
  delete safeUser.password;
  delete safeUser.passwordHash;

  res.status(201).json({
    status: 201,
    message: 'User created successfully',
    user: safeUser,
    temporaryPassword: password ? undefined : initialPassword
  });
});

app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const targetId = Number(req.params.id);
  const targetUser = salesPersons.find((s) => Number(s.id) === targetId);
  if (!targetUser) {
    return res.status(404).json({ status: 404, message: 'User not found.' });
  }

  const { name, phone, role, clusterid, active, password } = req.body || {};

  // Protection Guard: Cannot demote or deactivate the last active Admin
  const isTargetActiveAdmin = (targetUser.role || '').toLowerCase() === 'admin' && Number(targetUser.active) === 1;
  const activeAdmins = salesPersons.filter((s) => (s.role || '').toLowerCase() === 'admin' && Number(s.active) === 1);
  if (isTargetActiveAdmin && activeAdmins.length <= 1) {
    if (active === 0 || active === false || (role && role !== 'Admin')) {
      return res.status(400).json({
        status: 400,
        message: 'Security Protection: Cannot demote or deactivate the last active Administrator. System must have at least one active Admin.'
      });
    }
  }

  let updatedPhone = targetUser.phone;
  let updatedPhoneValid = targetUser.phoneValid ? 1 : 0;

  if (phone !== undefined) {
    const rawPhone = String(phone);
    if (!isValidIndianMobile(rawPhone)) {
      return res.status(400).json({
        status: 400,
        message: 'Invalid mobile number: must be an Indian mobile number containing exactly 10 digits starting with 6, 7, 8, or 9 (no spaces, letters, or country codes).'
      });
    }
    const existing = salesPersons.find((s) => s.phone === rawPhone && Number(s.id) !== targetId);
    if (existing) {
      return res.status(400).json({
        status: 400,
        message: `Mobile number ${rawPhone} is already registered to user '${existing.name}' (#${existing.id}).`
      });
    }
    updatedPhone = rawPhone;
    updatedPhoneValid = 1;
  }

  let updatedRole = targetUser.role;
  if (role !== undefined) {
    const validRoles = STAFF_ROLES;
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        status: 400,
        message: `Invalid role '${role}'. Role must be one of: ${validRoles.join(', ')}`
      });
    }
    updatedRole = role;
  }

  let updatedPasswordHash = targetUser.passwordHash;
  let updatedMustChange = targetUser.mustChangePassword ? 1 : 0;
  let shouldRevokeSessions = false;

  if (password) {
    const trimmedPwd = String(password).trim();
    if (trimmedPwd.length < 8) {
      return res.status(400).json({ status: 400, message: 'Password must be at least 8 characters long.' });
    }
    if (isKnownDemoPassword(trimmedPwd)) {
      return res.status(400).json({
        status: 400,
        message: 'Security Policy: Known demo or weak default passwords cannot be used.'
      });
    }
    updatedPasswordHash = hashPassword(trimmedPwd);
    shouldRevokeSessions = true;
  }

  // Handle mustChangePassword explicitly from request body if passed;
  // If password was reset and mustChangePassword was not explicitly specified,
  // default to 0 (cleared) so that an Admin-managed password does not force a secondary change.
  if (req.body && req.body.mustChangePassword !== undefined) {
    updatedMustChange = req.body.mustChangePassword ? 1 : 0;
  } else if (password) {
    updatedMustChange = 0;
  }

  if (updatedMustChange === 1 && !targetUser.mustChangePassword) {
    shouldRevokeSessions = true;
  }

  const updatedName = name ? String(name).trim() : targetUser.name;
  const updatedClusterId = clusterid !== undefined ? Number(clusterid) : Number(targetUser.clusterid || 1);
  const updatedActive = active !== undefined ? (active ? 1 : 0) : Number(targetUser.active);

  if (updatedActive === 0 || updatedRole !== targetUser.role) {
    shouldRevokeSessions = true;
  }

  await db.withTransaction(async (tx) => {
    await tx.query(
      `UPDATE users
       SET name = $1, role = $2, phone = $3, phone_valid = $4, password_hash = $5, must_change_password = $6, cluster_id = $7, active = $8
       WHERE id = $9`,
      [
        updatedName,
        updatedRole,
        updatedPhone || null,
        updatedPhoneValid,
        updatedPasswordHash,
        updatedMustChange,
        updatedClusterId,
        updatedActive,
        targetId
      ]
    );

    if (targetUser.role !== updatedRole) {
      if (targetUser.role === 'Sales Manager' && updatedRole !== 'Sales Manager') {
        await tx.query('DELETE FROM manager_assignments WHERE manager_id = $1', [targetId]);
      } else if (targetUser.role === 'Field Sales Agent' && updatedRole !== 'Field Sales Agent') {
        await tx.query('DELETE FROM manager_assignments WHERE agent_id = $1', [targetId]);
      }
    }
  });

  if (shouldRevokeSessions) {
    await revokeAllUserSessions(targetId);
  }

  await refreshStateFromDb();
  await addAuditLog(req, 'USER_UPDATE', 'User', targetId, `Updated details for ${updatedName} (Role: ${updatedRole}, Active: ${updatedActive})`);

  const refreshedUser = salesPersons.find((s) => Number(s.id) === targetId);
  const safeUser = { ...refreshedUser };
  delete safeUser.password;
  delete safeUser.passwordHash;

  res.json({ status: 200, message: 'User updated successfully', user: safeUser });
});

app.post('/api/admin/users/:id/status', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const targetId = Number(req.params.id);
  const targetUser = salesPersons.find((s) => Number(s.id) === targetId);
  if (!targetUser) {
    return res.status(404).json({ status: 404, message: 'User not found.' });
  }

  const newStatus = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : (targetUser.active === 1 ? 0 : 1);

  const isTargetActiveAdmin = (targetUser.role || '').toLowerCase() === 'admin' && Number(targetUser.active) === 1;
  const activeAdmins = salesPersons.filter((s) => (s.role || '').toLowerCase() === 'admin' && Number(s.active) === 1);
  if (isTargetActiveAdmin && activeAdmins.length <= 1 && newStatus === 0) {
    return res.status(400).json({
      status: 400,
      message: 'Security Protection: Cannot deactivate the last active Administrator.'
    });
  }

  await db.query('UPDATE users SET active = $1 WHERE id = $2', [newStatus, targetId]);
  if (newStatus === 0) {
    await revokeAllUserSessions(targetId);
  }

  await refreshStateFromDb();
  await addAuditLog(req, newStatus === 1 ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', 'User', targetId, `${newStatus === 1 ? 'Activated' : 'Deactivated'} user '${targetUser.name}'`);

  res.json({ status: 200, message: `User status changed to ${newStatus === 1 ? 'Active' : 'Inactive'}`, active: newStatus });
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const targetId = Number(req.params.id);
  const targetUser = salesPersons.find((s) => Number(s.id) === targetId);
  if (!targetUser) {
    return res.status(404).json({ status: 404, message: 'User not found.' });
  }

  const caller = getCaller(req);
  if (caller && Number(caller.id) === targetId) {
    return res.status(400).json({
      status: 400,
      message: 'Security Protection: You cannot delete your own currently authenticated Administrator account.'
    });
  }

  const isTargetActiveAdmin = (targetUser.role || '').toLowerCase() === 'admin' && Number(targetUser.active) === 1;
  const activeAdmins = salesPersons.filter((s) => (s.role || '').toLowerCase() === 'admin' && Number(s.active) === 1);
  if (isTargetActiveAdmin && activeAdmins.length <= 1) {
    return res.status(400).json({
      status: 400,
      message: 'Security Protection: Cannot delete the last active Administrator. System must have at least one active Admin.'
    });
  }

  await db.withTransaction(async (tx) => {
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
    await tx.query('DELETE FROM manager_assignments WHERE manager_id = $1 OR agent_id = $1', [targetId]);
    await tx.query('DELETE FROM sales_targets WHERE agent_id = $1 OR manager_id = $1', [targetId]);
    await tx.query('DELETE FROM users WHERE id = $1', [targetId]);
  });

  await refreshStateFromDb();
  await addAuditLog(req, 'USER_DELETE', 'User', targetId, `Deleted user '${targetUser.name}' (Role: ${targetUser.role}, Phone: ${targetUser.phone})`);

  res.json({
    status: 200,
    message: `User '${targetUser.name}' (#${targetId}) was permanently deleted.`,
    deletedId: targetId
  });
});

// 3. Admin Roles & Permissions APIs
app.get('/api/admin/permissions', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  res.json({ status: 200, permissions: rolePermissions });
});

const EDITABLE_PERMISSION_ROLES = STAFF_ROLES.filter((r) => r !== 'Admin');

app.put('/api/admin/permissions', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const { role, pages, actions } = req.body || {};

  if (role === 'Admin') {
    return res.status(400).json({
      status: 400,
      message: 'Security Protection: Administrator permissions are immutable to prevent system lockout.'
    });
  }

  // T0.3 (R5): only the three editable staff roles, exact names; anything else is refused before any write
  if (typeof role !== 'string' || !EDITABLE_PERMISSION_ROLES.includes(role)) {
    return res.status(400).json({
      status: 400,
      code: 'INVALID_ROLE',
      message: `Invalid role. Permissions can be changed only for: ${EDITABLE_PERMISSION_ROLES.join(', ')}.`
    });
  }

  if (!rolePermissions[role]) {
    return res.status(404).json({ status: 404, message: `Role '${role}' not found.` });
  }

  const prev = JSON.stringify(rolePermissions[role]);
  const updatedPages = Array.isArray(pages) ? pages : rolePermissions[role].pages;
  const updatedActions = Array.isArray(actions) ? actions : rolePermissions[role].actions;

  await db.query(
    `INSERT INTO role_permissions (role, pages_json, actions_json, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (role) DO UPDATE SET pages_json = $2, actions_json = $3, updated_at = $4`,
    [role, JSON.stringify(updatedPages), JSON.stringify(updatedActions), new Date().toISOString()]
  );

  await refreshStateFromDb();
  await addAuditLog(req, 'PERMISSIONS_UPDATE', 'RolePermissions', role, { previous: prev, updated: rolePermissions[role] });

  res.json({ status: 200, message: `Permissions updated for role ${role}`, permissions: rolePermissions });
});

// 4. Admin Organization-Wide Orders
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const { managerId, agentId, clusterId, category, shopId, status, fromDate, toDate } = req.query;

  let allowedAgentIds = null;
  if (managerId && managerId !== 'all') {
    allowedAgentIds = getAssignedAgentIds(managerId);
  }

  const filtered = submittedOrders.filter((o) => {
    if (allowedAgentIds && !allowedAgentIds.includes(Number(o.spersonid))) return false;
    if (agentId && agentId !== 'all' && Number(o.spersonid) !== Number(agentId)) return false;
    if (fromDate && o.date < fromDate) return false;
    if (toDate && o.date > toDate) return false;
    if (clusterId && clusterId !== 'all' && Number(o.clusterId) !== Number(clusterId)) return false;
    if (category && category !== 'all' && (o.shopCategory || '').toLowerCase() !== category.toLowerCase()) return false;
    if (shopId && shopId !== 'all' && String(o.customerId) !== String(shopId) && String(o.shopId) !== String(shopId)) return false;
    if (status && status !== 'all' && (o.status || '').toLowerCase() !== status.toLowerCase()) return false;
    return true;
  });

  const totalAmount = filtered.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalUnits = filtered.reduce((sum, o) => {
    const units = (o.orderList || []).reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
    return sum + (units || o.itemsCount || 0);
  }, 0);
  const count = filtered.length;
  const averageOrderValue = count > 0 ? Math.round(totalAmount / count) : 0;

  res.json({
    status: 200,
    orders: filtered,
    totals: { count, totalAmount, totalUnits, averageOrderValue }
  });
});

// ============================================================================
// DELIVERY AGENT WORKFLOW & LOGISTICS FULFILLMENT APIS
// ============================================================================

app.get('/api/delivery/orders', requireAuth, async (req, res) => {
  await refreshStateFromDb();
  const caller = getCaller(req);
  const callerRole = caller.role || '';
  const isAdmin = callerRole.toLowerCase() === 'admin';
  const isDelivery = callerRole.toLowerCase() === 'delivery agent';

  if (!isAdmin && !isDelivery && !checkActionPermission(callerRole, 'view_assigned_deliveries')) {
    return res.status(403).json({
      status: 403,
      message: "Access Denied: Role does not have permission 'view_assigned_deliveries'"
    });
  }

  // Delivery Agents cannot query another delivery agent's orders
  if (!isAdmin && req.query.agentId && Number(req.query.agentId) !== Number(caller.id)) {
    return res.status(403).json({
      status: 403,
      message: 'Access Denied: Delivery Agents can only view orders assigned to their own account.'
    });
  }

  const targetAgentId = (!isAdmin || !req.query.agentId) ? Number(caller.id) : Number(req.query.agentId);
  const targetClusterId = req.query.clusterId && req.query.clusterId !== 'all' ? Number(req.query.clusterId) : null;

  const agentOrders = submittedOrders.filter((o) => {
    if (!isAdmin && Number(o.deliveryAgentId) !== targetAgentId) return false;
    if (isAdmin && req.query.agentId && Number(o.deliveryAgentId) !== targetAgentId) return false;
    if (targetClusterId && Number(o.clusterId) !== targetClusterId) return false;
    return true;
  });

  const enrichedOrders = agentOrders.map((o) => {
    const shop = shops.find((s) =>
      Number(s.shopid) === Number(o.customerId) ||
      (o.shopId && String(o.shopId).replace(/^S0*/, '') === String(s.shopid))
    );
    const clusterObj = clusters.find((c) => Number(c.clusterId) === Number(o.clusterId));

    return {
      id: o.id,
      orderId: o.orderId || o.id,
      shopId: o.shopId || (shop ? `S${String(shop.shopid).padStart(3, '0')}` : ''),
      customerId: o.customerId,
      shopName: shop?.shopName || o.customer || 'Unnamed Shop',
      ownerName: shop?.ownerName || '',
      contactPhone: shop?.contact1 || shop?.contact2 || '',
      address: shop?.address || '',
      pincode: shop?.pincode || '',
      latitude: shop && !isNaN(parseFloat(shop.latitude)) ? parseFloat(shop.latitude) : null,
      longitude: shop && !isNaN(parseFloat(shop.longitude)) ? parseFloat(shop.longitude) : null,
      clusterId: Number(o.clusterId),
      clusterName: clusterObj?.clusterName || `Cluster ${o.clusterId}`,
      status: o.status || 'In progress',
      total: Number(o.total || 0),
      itemsCount: Number(o.itemsCount || (o.orderList ? o.orderList.length : 0)),
      orderList: o.orderList || [],
      deliveryAgentId: o.deliveryAgentId,
      deliveryReason: o.deliveryReason || null,
      deliveryNote: o.deliveryNote || null,
      deliveryUpdatedAt: o.deliveryUpdatedAt || null,
      paymentStatus: o.paymentStatus || 'Not collected',
      paymentAmountCollected: Number(o.paymentAmountCollected || 0),
      paymentBalanceDue: o.paymentBalanceDue !== undefined && o.paymentBalanceDue !== null
        ? Number(o.paymentBalanceDue)
        : Math.max(0, Number(o.total || 0) - Number(o.paymentAmountCollected || 0)),
      paymentCollectedAt: o.paymentCollectedAt || null,
      paymentCollectedBy: o.paymentCollectedBy || null,
      paymentCollectedByName: o.paymentCollectedByName || null
    };
  });

  const clusterSummaries = clusters.map((c) => {
    const cId = Number(c.clusterId);
    const assigned = submittedOrders.filter((o) =>
      (!isAdmin ? Number(o.deliveryAgentId) === targetAgentId : true) && Number(o.clusterId) === cId
    );
    let pendingCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    assigned.forEach((o) => {
      const st = (o.status || '').toLowerCase();
      if (st === 'delivered') deliveredCount++;
      else if (st === 'could not deliver' || st === 'cancelled') failedCount++;
      else pendingCount++;
    });
    return {
      clusterId: cId,
      clusterName: c.clusterName,
      assignedOrdersCount: assigned.length,
      pendingCount,
      deliveredCount,
      failedCount
    };
  });

  res.json({
    status: 200,
    agent: {
      id: caller.id,
      name: caller.name,
      role: caller.role,
      phone: caller.phone
    },
    orders: enrichedOrders,
    clusters: clusterSummaries
  });
});

app.post('/api/delivery/orders/:id/status', requireAuth, async (req, res) => {
  await refreshStateFromDb();
  const caller = getCaller(req);
  const callerRole = caller.role || '';
  const isAdmin = callerRole.toLowerCase() === 'admin';
  const isDelivery = callerRole.toLowerCase() === 'delivery agent';

  if (!isAdmin && !isDelivery && !checkActionPermission(callerRole, 'update_delivery_status')) {
    return res.status(403).json({
      status: 403,
      message: "Access Denied: Role does not have permission 'update_delivery_status'"
    });
  }

  const orderId = String(req.params.id);
  const order = submittedOrders.find((o) => String(o.id) === orderId || String(o.orderId) === orderId);
  if (!order) {
    return res.status(404).json({ status: 404, message: `Order '${orderId}' not found` });
  }

  if (!isAdmin && Number(order.deliveryAgentId) !== Number(caller.id)) {
    return res.status(403).json({
      status: 403,
      message: `Access Denied: You are not assigned to delivery order '${orderId}'`
    });
  }

  const { status, reason, note } = req.body || {};
  const idempotencyKey = String(req.headers['x-idempotency-key'] || req.body?.idempotencyKey || '').trim() || null;
  const deviceEventTime = req.headers['x-device-event-time'] || req.body?.deviceEventTime || null;

  const allowedStatuses = ['Pending', 'In progress', 'Picked up', 'Delivered', 'Could not deliver'];
  if (!status || !allowedStatuses.includes(status)) {
    return res.status(400).json({
      status: 400,
      message: `Invalid status '${status}'. Must be one of: ${allowedStatuses.join(', ')}`
    });
  }

  const currentStatus = effectiveStatus(order.status);

  // Idempotency: if the order is already in the target status, return 200 idempotent replay
  if (currentStatus === status) {
    return res.status(200).json({
      status: 200,
      message: `Order '${orderId}' is already '${status}'`,
      idempotentReplay: true,
      order: {
        id: order.id,
        orderId: order.orderId || order.id,
        status: currentStatus,
        deliveryReason: order.deliveryReason || null,
        deliveryNote: order.deliveryNote || null,
        deliveryUpdatedAt: order.deliveryUpdatedAt || null,
        paymentStatus: order.paymentStatus || 'Not collected',
        paymentAmountCollected: Number(order.paymentAmountCollected || 0),
        paymentBalanceDue: Number(order.paymentBalanceDue || 0),
        total: Number(order.total || 0)
      }
    });
  }

  // Every refusal after this point is recorded so the office can see what a device tried to do.
  const auditRejection = (httpStatus, code, message, currentForLog) =>
    addAuditLog(
      req,
      'DELIVERY_STATUS_REJECTED',
      'Order',
      order.id,
      `Rejected delivery status update for order ${order.id}: '${currentForLog}' -> '${status}' (HTTP ${httpStatus}${code ? ` ${code}` : ''}: ${message})${deviceEventTime ? ` [deviceEventTime: ${deviceEventTime}]` : ''}${idempotencyKey ? ` [idempotencyKey: ${idempotencyKey}]` : ''}`
    ).catch(() => {});

  if (currentStatus === 'Price approval pending') {
    const message = `Invalid status transition: Order '${orderId}' is currently 'Price approval pending' and cannot be dispatched or updated until approved.`;
    await auditRejection(400, null, message, currentStatus);
    return res.status(400).json({ status: 400, message });
  }

  // New apps send the status they saw when the agent acted; a mismatch means the update is stale.
  const expectedStatus = req.body?.expectedStatus ? String(req.body.expectedStatus) : null;
  if (expectedStatus && !sameLifecycleState(expectedStatus, currentStatus)) {
    const body = conflictBody({
      code: 'STALE_UPDATE',
      orderId,
      currentStatus,
      requestedStatus: status,
      message: `Order '${orderId}' changed to '${currentStatus}' after this update was made on the device (expected '${expectedStatus}'). The update was not applied.`
    });
    await auditRejection(409, body.code, body.message, currentStatus);
    return res.status(409).json(body);
  }

  const transition = checkTransition(currentStatus, status, isAdmin ? 'admin' : 'agent');
  if (!transition.ok) {
    const body = conflictBody({ orderId, currentStatus, requestedStatus: status, message: transition.message });
    await auditRejection(409, body.code, body.message, currentStatus);
    return res.status(409).json(body);
  }

  if (status === 'Could not deliver') {
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      const message = "A short reason is required when marking an order as 'Could not deliver'";
      await auditRejection(400, null, message, currentStatus);
      return res.status(400).json({ status: 400, message });
    }
  }

  const updatedAt = new Date().toISOString();
  const updatedReason = reason ? String(reason).trim() : (order.deliveryReason || null);
  const updatedNote = note ? String(note).trim() : (order.deliveryNote || null);

  // Payment collection validation & calculation
  let paymentAmount = Number(order.paymentAmountCollected || 0);
  let paymentStatus = order.paymentStatus || 'Not collected';
  let balanceDue = Number(order.paymentBalanceDue !== undefined && order.paymentBalanceDue !== null ? order.paymentBalanceDue : (order.total || 0));
  let paymentCollectedAt = order.paymentCollectedAt || null;
  let paymentCollectedBy = order.paymentCollectedBy || null;
  let paymentCollectedByName = order.paymentCollectedByName || null;

  if (status === 'Delivered') {
    const rawCollected = req.body?.paymentAmountCollected ?? req.body?.amountCollected ?? req.body?.paymentAmount;
    const orderTotal = Number(order.total || 0);

    if (rawCollected !== undefined && rawCollected !== null && rawCollected !== '') {
      paymentAmount = Number(rawCollected);
      if (isNaN(paymentAmount) || paymentAmount < 0) {
        return res.status(400).json({
          status: 400,
          message: 'Invalid payment amount: collected amount must be a non-negative number.'
        });
      }
      if (paymentAmount > orderTotal) {
        return res.status(400).json({
          status: 400,
          message: `Collected amount (₹${paymentAmount}) cannot exceed order total of ₹${orderTotal}.`
        });
      }
    } else {
      paymentAmount = 0;
    }

    balanceDue = Math.max(0, orderTotal - paymentAmount);
    if (paymentAmount >= orderTotal && orderTotal > 0) {
      paymentStatus = 'Collected';
    } else if (paymentAmount > 0) {
      paymentStatus = 'Partially collected';
    } else {
      paymentStatus = 'Not collected';
    }

    paymentCollectedAt = updatedAt;
    paymentCollectedBy = Number(caller.id);
    paymentCollectedByName = caller.name || 'Delivery Agent';
  }

  // Atomic write: applies only if the order still has the status checked above, so an admin
  // cancellation (or any other change) that lands in between is never overwritten.
  const write = await updateOrderIfStatus(
    db,
    order.orderId || order.id,
    currentStatus,
    `status = $1, delivery_reason = $2, delivery_note = $3, delivery_updated_at = $4, delivery_updated_by = $5,
     payment_status = $6, payment_amount_collected = $7, payment_balance_due = $8,
     payment_collected_at = $9, payment_collected_by = $10, payment_collected_by_name = $11`,
    [
      status, updatedReason, updatedNote, updatedAt, Number(caller.id),
      paymentStatus, paymentAmount, balanceDue,
      paymentCollectedAt, paymentCollectedBy, paymentCollectedByName
    ]
  );

  if (!write.applied) {
    await refreshStateFromDb();
    if (write.currentStatus === status) {
      // An identical update won the race: same outcome, report it as a replay
      const fresh = submittedOrders.find((o) => String(o.id) === orderId || String(o.orderId) === orderId) || order;
      return res.status(200).json({
        status: 200,
        message: `Order '${orderId}' is already '${status}'`,
        idempotentReplay: true,
        order: {
          id: fresh.id,
          orderId: fresh.orderId || fresh.id,
          status,
          deliveryReason: fresh.deliveryReason || null,
          deliveryNote: fresh.deliveryNote || null,
          deliveryUpdatedAt: fresh.deliveryUpdatedAt || null,
          paymentStatus: fresh.paymentStatus || 'Not collected',
          paymentAmountCollected: Number(fresh.paymentAmountCollected || 0),
          paymentBalanceDue: Number(fresh.paymentBalanceDue || 0),
          total: Number(fresh.total || 0)
        }
      });
    }
    const body = conflictBody({
      orderId,
      currentStatus: write.currentStatus,
      requestedStatus: status,
      message: `Order '${orderId}' changed to '${write.currentStatus}' while this update was being saved. The update was not applied.`
    });
    await auditRejection(409, body.code, body.message, write.currentStatus);
    return res.status(409).json(body);
  }

  await refreshStateFromDb();
  await addAuditLog(
    req,
    'UPDATE_DELIVERY_STATUS',
    'Order',
    order.id,
    `Updated order ${order.id} delivery status from '${currentStatus}' to '${status}'${updatedReason ? ` (Reason: ${updatedReason})` : ''} (Payment: ${paymentStatus}, Collected: ₹${paymentAmount}, Balance: ₹${balanceDue})${deviceEventTime ? ` [deviceEventTime: ${deviceEventTime}]` : ''}${idempotencyKey ? ` [idempotencyKey: ${idempotencyKey}]` : ''}`
  );

  res.json({
    status: 200,
    message: `Delivery status updated to '${status}'`,
    order: {
      id: order.id,
      orderId: order.orderId || order.id,
      status,
      deliveryReason: updatedReason,
      deliveryUpdatedAt: updatedAt,
      paymentStatus,
      paymentAmountCollected: paymentAmount,
      paymentBalanceDue: balanceDue,
      paymentCollectedBy,
      paymentCollectedByName,
      paymentCollectedAt,
      total: Number(order.total || 0)
    }
  });
});

// 5. Admin Organization-Wide Executive Reports
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const { clusterId, managerId, agentId } = req.query;
  const hasPeriodOrDates = Boolean(req.query.period || req.query.range || req.query.fromDate || req.query.startDate || req.query.toDate || req.query.endDate);
  const periodInfo = resolveReportPeriodRange(req.query);
  const fromDate = hasPeriodOrDates ? periodInfo.fromDate : null;
  const toDate = hasPeriodOrDates ? periodInfo.toDate : null;

  let allowedAgentIds = null;
  if (managerId && managerId !== 'all') {
    allowedAgentIds = getAssignedAgentIds(managerId).filter((aid) => {
      const u = salesPersons.find((s) => Number(s.id) === Number(aid));
      return u && (u.role || '').toLowerCase() === 'field sales agent' && Number(u.active) === 1;
    });
  }
  if (agentId && agentId !== 'all') {
    allowedAgentIds = [Number(agentId)];
  }

  const orders = submittedOrders.filter((o) => {
    if (allowedAgentIds && !allowedAgentIds.includes(Number(o.spersonid))) return false;
    const dStr = String(o.date || '').slice(0, 10);
    if (fromDate && dStr < fromDate) return false;
    if (toDate && dStr > toDate) return false;
    if (clusterId && clusterId !== 'all' && Number(o.clusterId) !== Number(clusterId)) return false;
    return true;
  });

  const achievedAmount = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const matchedTargets = salesTargets.filter((t) => {
    if (allowedAgentIds && !allowedAgentIds.includes(Number(t.agentId))) return false;
    if (clusterId && clusterId !== 'all' && Number(t.clusterId) !== Number(clusterId)) return false;
    return true;
  });

  const targetAmount = matchedTargets.reduce((sum, t) => sum + Number(t.targetAmount || 0), 0);
  const targetGap = Math.max(0, targetAmount - achievedAmount);
  const differenceAmount = Number((achievedAmount - targetAmount).toFixed(2));
  const achievementRate = targetAmount > 0 ? Math.min(100, Math.round((achievedAmount / targetAmount) * 100)) : 0;
  const achievementPct = targetAmount > 0 ? Number(((achievedAmount / targetAmount) * 100).toFixed(1)) : 0;
  const performanceIndicator = getPerformanceIndicator(achievementPct, targetAmount > 0);

  const scopedShops = shops.filter((s) => {
    if (clusterId && clusterId !== 'all' && Number(s.clusterid) !== Number(clusterId)) return false;
    if (allowedAgentIds && !allowedAgentIds.includes(Number(s.assignedAgentId || s.assigned_agent_id))) return false;
    return true;
  });
  const orderedShopIds = new Set(orders.map((o) => Number(o.customerId || o.shopid || 0)).filter((id) => id > 0));

  res.json({
    status: 200,
    report: {
      timezone: 'Asia/Kolkata',
      periodInfo,
      hasTarget: targetAmount > 0,
      targetAmount,
      achievedAmount,
      differenceAmount,
      targetGap,
      achievementRate,
      achievementPct,
      performanceIndicator,
      performanceIndicatorScale: PERFORMANCE_INDICATOR_SCALE,
      shopCounts: {
        assignedShopsCount: scopedShops.length,
        visitedShopsCount: orderedShopIds.size,
        orderedShopsCount: orderedShopIds.size,
        notOrderedShopsCount: Math.max(0, scopedShops.length - orderedShopIds.size)
      },
      frequentlyOrderedCustomers: computeFrequentlyOrderedCustomers(orders, scopedShops, periodInfo),
      ordersCount: orders.length
    }
  });
});

// 6. Admin Audit Logs API
app.get('/api/admin/audit', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const { action, adminId, limit = 100 } = req.query;
  let filtered = auditLogs;
  if (action && action !== 'all') {
    filtered = filtered.filter((l) => l.action === action);
  }
  if (adminId && adminId !== 'all') {
    filtered = filtered.filter((l) => Number(l.adminId) === Number(adminId));
  }
  res.json({ status: 200, logs: filtered.slice(0, Number(limit)) });
});

// 7. Admin Application Settings APIs
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  res.json({ status: 200, settings: appSettings });
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const prev = JSON.stringify(appSettings);
  const visitSettingError = validateVisitSettingUpdates(req.body || {}, appSettings);
  if (visitSettingError) {
    return res.status(400).json({ status: 400, message: visitSettingError });
  }
  const updatedSettings = { ...appSettings, ...(req.body || {}) };

  await db.query(
    `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
     VALUES ('global', $1, $2)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value_json = $1, updated_at = $2`,
    [JSON.stringify(updatedSettings), new Date().toISOString()]
  );

  await refreshStateFromDb();
  await addAuditLog(req, 'SETTINGS_UPDATE', 'AppSettings', 'global', { previous: prev, updated: appSettings });
  res.json({ status: 200, message: 'Settings saved successfully', settings: appSettings });
});

// 8. Admin Global Targets APIs
app.get('/api/admin/targets', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const { period, managerId, clusterId, agentId } = req.query || {};

  const filtered = salesTargets.filter((t) => {
    if (period && period !== 'all' && t.period !== period) return false;
    if (managerId && managerId !== 'all' && Number(t.managerId) !== Number(managerId)) return false;
    if (clusterId && clusterId !== 'all' && Number(t.clusterId) !== Number(clusterId)) return false;
    if (agentId && agentId !== 'all' && Number(t.agentId) !== Number(agentId)) return false;
    return true;
  });

  const enrichedTargets = filtered.map((t) => {
    const agent = salesPersons.find((s) => Number(s.id) === Number(t.agentId));
    const manager = salesPersons.find((s) => Number(s.id) === Number(t.managerId));
    const cluster = clusters.find((c) => Number(c.clusterId) === Number(t.clusterId));

    const agentOrders = submittedOrders.filter((o) => {
      if (Number(o.spersonid) !== Number(t.agentId)) return false;
      if (t.period && !(o.date || '').startsWith(t.period)) return false;
      return true;
    });

    const achievedAmount = agentOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const targetAmt = Number(t.targetAmount || 0);
    const fulfillmentRate = targetAmt > 0 ? Math.round((achievedAmount / targetAmt) * 100) : 0;
    const gapAmount = Math.max(0, targetAmt - achievedAmount);

    return {
      ...t,
      agentName: agent ? agent.name : `Agent #${t.agentId}`,
      agentPhone: agent ? agent.phone : '',
      managerName: manager ? manager.name : `Manager #${t.managerId}`,
      clusterName: cluster ? cluster.clusterName : `Cluster ${t.clusterId}`,
      achievedAmount,
      fulfillmentRate,
      gapAmount,
      orderCount: agentOrders.length
    };
  });

  const allPeriods = Array.from(new Set(['2026-10', '2026-11', '2026-12', ...salesTargets.map((t) => t.period)])).sort();

  res.json({
    status: 200,
    targets: enrichedTargets,
    defaultPeriod: appSettings.defaultTargetPeriod || '2026-10',
    availablePeriods: allPeriods
  });
});

app.post('/api/admin/targets', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const caller = getCaller(req);
  const { id, agentId, managerId, clusterId, period, targetAmount, itemTargets } = req.body || {};

  if (!agentId) {
    return res.status(400).json({ status: 400, message: 'Field Sales Agent is required.' });
  }

  const agent = salesPersons.find((s) => Number(s.id) === Number(agentId));
  if (!agent) {
    return res.status(404).json({ status: 404, message: `Agent #${agentId} not found.` });
  }

  const targetPeriod = (period || appSettings.defaultTargetPeriod || '2026-10').trim();
  const amt = Number(targetAmount);
  if (isNaN(amt) || amt < 0) {
    return res.status(400).json({ status: 400, message: 'Target amount must be a non-negative number.' });
  }

  let effectiveManagerId = Number(managerId);
  if (!effectiveManagerId) {
    const mEntry = Object.entries(managerAssignments).find(([_, agentIds]) => agentIds.includes(Number(agentId)));
    effectiveManagerId = mEntry ? Number(mEntry[0]) : 100;
  }

  const effectiveClusterId = Number(clusterId || agent.clusterid || 1);

  const sanitizedItemTargets = Array.isArray(itemTargets) ? itemTargets.map((it) => ({
    itemId: Number(it.itemId),
    itemName: String(it.itemName || `Item ${it.itemId}`),
    targetQty: Number(it.targetQty || 0),
    targetAmount: Number(it.targetAmount || 0)
  })) : [];

  const nowIso = new Date().toISOString();
  let savedTargetId = 0;
  let isUpdate = false;

  await db.withTransaction(async (tx) => {
    await db.lockAllocation(tx, 'sales_targets');
    const existingRes = id
      ? await tx.query('SELECT id FROM sales_targets WHERE id = $1', [Number(id)])
      : await tx.query('SELECT id FROM sales_targets WHERE agent_id = $1 AND period = $2', [Number(agentId), targetPeriod]);

    if (existingRes.rowCount > 0) {
      isUpdate = true;
      savedTargetId = Number(existingRes.rows[0].id);
      await tx.query(
        `UPDATE sales_targets
         SET agent_id = $1, manager_id = $2, cluster_id = $3, period = $4, target_amount = $5, item_targets_json = $6, updated_at = $7, updated_by = $8
         WHERE id = $9`,
        [Number(agentId), effectiveManagerId, effectiveClusterId, targetPeriod, amt, JSON.stringify(sanitizedItemTargets), nowIso, Number(caller.id), savedTargetId]
      );
    } else {
      const maxRes = await tx.query('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sales_targets');
      savedTargetId = Number(maxRes.rows[0]?.next_id || 1);
      await tx.query(
        `INSERT INTO sales_targets (id, agent_id, manager_id, cluster_id, period, target_amount, item_targets_json, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [savedTargetId, Number(agentId), effectiveManagerId, effectiveClusterId, targetPeriod, amt, JSON.stringify(sanitizedItemTargets), nowIso, Number(caller.id)]
      );
    }
  });

  await refreshStateFromDb();
  await addAuditLog(
    req,
    isUpdate ? 'TARGET_UPDATE' : 'TARGET_CREATE',
    'SalesTarget',
    savedTargetId,
    `${isUpdate ? 'Updated' : 'Created'} quota for ${agent.name}: ₹${amt} (${targetPeriod})`
  );

  const savedTarget = salesTargets.find((t) => Number(t.id) === savedTargetId);
  res.json({
    status: 200,
    message: `Target quota saved successfully for ${agent.name}`,
    target: savedTarget
  });
});

app.delete('/api/admin/targets/:id', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const targetId = Number(req.params.id);
  const removed = salesTargets.find((t) => Number(t.id) === targetId);
  if (!removed) {
    return res.status(404).json({ status: 404, message: `Target #${targetId} not found.` });
  }

  const agent = salesPersons.find((s) => Number(s.id) === Number(removed.agentId));
  const agentName = agent ? agent.name : `Agent #${removed.agentId}`;

  await db.query('DELETE FROM sales_targets WHERE id = $1', [targetId]);
  await refreshStateFromDb();
  await addAuditLog(req, 'TARGET_DELETE', 'SalesTarget', targetId, `Deleted quota #${targetId} for ${agentName} (${removed.period})`);

  res.json({
    status: 200,
    message: `Target quota #${targetId} for ${agentName} has been deleted.`,
    deletedId: targetId
  });
});

// ============================================================================
// ITEMS & DAILY PRICING ENDPOINTS (Admin & Sales Manager Scoped)
// ============================================================================

// 1. GET /api/items (Fetch product catalog and daily prices)
app.get('/api/items', async (req, res) => {
  await refreshStateFromDb();
  const caller = getCaller(req);
  if (!caller) {
    return res.status(401).json({ status: 401, message: 'Authentication required: valid Bearer session token must be provided.' });
  }

  const callerRole = (caller.role || '').toLowerCase();
  const isAdmin = callerRole === 'admin';
  const isManager = callerRole === 'sales manager';

  if (!isAdmin && !isManager && !checkActionPermission(caller.role, 'view_items') && !checkActionPermission(caller.role, 'manage_items')) {
    return res.status(403).json({ status: 403, message: 'Permission Denied: Accessing product catalog is disabled for your role.' });
  }

  const authorizedClusterIds = getAuthorizedClusterIds(caller);
  const clusterIdFilter = req.query.clusterId ? (req.query.clusterId === 'all' ? 'all' : Number(req.query.clusterId)) : 'all';

  // Build cluster-specific prices map per item
  const clusterPriceMap = {};
  for (const row of clusterItemPrices) {
    const iid = Number(row.itemId);
    const cid = Number(row.clusterId);
    // If manager, only include prices for authorized clusters
    if (!isAdmin && !authorizedClusterIds.includes(cid)) continue;
    if (!clusterPriceMap[iid]) clusterPriceMap[iid] = {};
    clusterPriceMap[iid][cid] = {
      price: Number(row.price),
      effectiveDate: row.effectiveDate,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      updatedByName: row.updatedByName
    };
  }

  const catalog = (orderItemsCatalog.length > 0 ? orderItemsCatalog : defaultOrderItems).map((item) => {
    const itemId = Number(item.itemId || item.itemid);
    const itemClusterPrices = clusterPriceMap[itemId] || {};

    // Determine representative price for the current filter/scope
    let currentPrice = Number(item.price || 0);
    let effectiveDate = item.updatedAt ? item.updatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
    let lastUpdatedAt = item.updatedAt || null;
    let lastUpdatedByName = item.updatedByName || null;

    if (clusterIdFilter !== 'all' && itemClusterPrices[clusterIdFilter]) {
      const cp = itemClusterPrices[clusterIdFilter];
      currentPrice = cp.price;
      effectiveDate = cp.effectiveDate;
      lastUpdatedAt = cp.updatedAt;
      lastUpdatedByName = cp.updatedByName;
    } else if (isManager && authorizedClusterIds.length > 0) {
      const primaryCluster = authorizedClusterIds[0];
      if (itemClusterPrices[primaryCluster]) {
        const cp = itemClusterPrices[primaryCluster];
        currentPrice = cp.price;
        effectiveDate = cp.effectiveDate;
        lastUpdatedAt = cp.updatedAt;
        lastUpdatedByName = cp.updatedByName;
      }
    }

    return {
      itemId,
      itemid: itemId,
      itemName: item.itemName,
      itemImage: item.itemImage || item.itemimage || '',
      itemimage: item.itemImage || item.itemimage || '',
      unitType: item.unitType || 'Kgs',
      kgsPerUnit: Number(item.kgsPerUnit || item.kgsperunit || 50),
      kgsperunit: Number(item.kgsPerUnit || item.kgsperunit || 50),
      basePrice: Number(item.price || 0),
      currentPrice,
      effectiveDate,
      lastUpdatedAt,
      lastUpdatedByName,
      active: Number(item.active ?? 1),
      clusterPrices: itemClusterPrices
    };
  });

  res.json({
    status: 200,
    items: catalog,
    clusters: isAdmin ? clusters : clusters.filter((c) => authorizedClusterIds.includes(Number(c.clusterId))),
    authorizedClusterIds,
    canManageCatalog: isAdmin,
    canUpdatePrices: true
  });
});

// Backward-compatible Admin wholesale commodities endpoint
app.get('/api/admin/items', (req, res) => {
  const caller = getCaller(req);
  if (!caller) {
    return res.status(401).json({ status: 401, message: 'Authentication required' });
  }
  const callerRole = (caller.role || '').toLowerCase();
  if (callerRole !== 'admin' && callerRole !== 'sales manager') {
    return res.status(403).json({ status: 403, message: 'Access Denied: Administrator or Sales Manager role required.' });
  }
  const items = orderItemsCatalog.length > 0 ? orderItemsCatalog : defaultOrderItems;
  res.json({ status: 200, items });
});

// 2. POST /api/items (Admin only: Create new catalog product)
app.post('/api/items', requireAdmin, async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    const { itemName, unitType = 'Kgs', price = 0, kgsPerUnit = 50, itemImage = '' } = req.body || {};

    const cleanName = String(itemName || '').trim();
    if (!cleanName) {
      return res.status(400).json({ status: 400, message: 'Product name is required and cannot be empty.' });
    }

    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({ status: 400, message: 'Price must be a valid non-negative number.' });
    }

    const numKgs = parseInt(kgsPerUnit, 10) || 50;
    const cleanUnit = String(unitType || 'Kgs').trim() || 'Kgs';
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);

    let createdItem = null;
    await db.withTransaction(async (tx) => {
      await db.lockAllocation(tx, 'items');
      const maxRes = await tx.query('SELECT COALESCE(MAX(item_id), 0) + 1 AS next_id FROM items');
      const nextItemId = Number(maxRes.rows[0]?.next_id || 1);

      await tx.query(
        `INSERT INTO items (item_id, item_name, item_image, qty, price, cprice, kgs_per_unit, remarks, unit_type, active, created_at, updated_at, updated_by, updated_by_name)
         VALUES ($1, $2, $3, 0, $4, 0, $5, 0, $6, 1, $7, $8, $9, $10)`,
        [nextItemId, cleanName, String(itemImage || ''), numPrice, numKgs, cleanUnit, nowIso, nowIso, Number(caller.id), caller.name]
      );

      // Record initial base price in price history
      const priceHistoryId = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await tx.query(
        `INSERT INTO price_history (id, item_id, cluster_id, old_price, new_price, effective_date, created_at, changed_by, changed_by_name)
         VALUES ($1, $2, 0, 0, $3, $4, $5, $6, $7)`,
        [priceHistoryId, nextItemId, numPrice, todayDate, nowIso, Number(caller.id), caller.name]
      );

      const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await tx.query(
        `INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details)
         VALUES ($1, $2, $3, $4, 'CREATE_ITEM', 'Item', $5, $6)`,
        [auditId, nowIso, Number(caller.id), caller.name, String(nextItemId), `Created wholesale product '${cleanName}' (#${nextItemId}) at base price ₹${numPrice}/${cleanUnit}`]
      );

      createdItem = {
        itemId: nextItemId,
        itemid: nextItemId,
        itemName: cleanName,
        itemImage: itemImage || '',
        price: numPrice,
        kgsPerUnit: numKgs,
        unitType: cleanUnit,
        active: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        updatedByName: caller.name
      };
    });

    await refreshStateFromDb();
    res.status(201).json({
      status: 201,
      message: `Product '${cleanName}' created successfully.`,
      item: createdItem
    });
  } catch (err) {
    console.error('[Create Item Error]', err);
    res.status(500).json({ status: 500, message: `Failed to create product: ${err.message}` });
  }
});

// 3. PUT /api/items/:id (Admin only: Update product details)
app.put('/api/items/:id', requireAdmin, async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    const itemId = Number(req.params.id);
    const existing = orderItemsCatalog.find((i) => Number(i.itemId || i.itemid) === itemId);
    if (!existing) {
      return res.status(404).json({ status: 404, message: `Product #${itemId} not found.` });
    }

    const { itemName, unitType, kgsPerUnit, itemImage } = req.body || {};
    const cleanName = itemName !== undefined ? String(itemName).trim() : existing.itemName;
    if (!cleanName) {
      return res.status(400).json({ status: 400, message: 'Product name cannot be empty.' });
    }

    const cleanUnit = unitType !== undefined ? String(unitType).trim() : existing.unitType;
    const numKgs = kgsPerUnit !== undefined ? (parseInt(kgsPerUnit, 10) || 50) : existing.kgsPerUnit;
    const cleanImage = itemImage !== undefined ? String(itemImage) : existing.itemImage;
    const nowIso = new Date().toISOString();

    await db.query(
      `UPDATE items
       SET item_name = $1, unit_type = $2, kgs_per_unit = $3, item_image = $4, updated_at = $5, updated_by = $6, updated_by_name = $7
       WHERE item_id = $8`,
      [cleanName, cleanUnit, numKgs, cleanImage, nowIso, Number(caller.id), caller.name, itemId]
    );

    const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.query(
      `INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, 'UPDATE_ITEM', 'Item', $5, $6)`,
      [auditId, nowIso, Number(caller.id), caller.name, String(itemId), `Updated product '${cleanName}' (#${itemId}) details`]
    );

    await refreshStateFromDb();
    res.json({
      status: 200,
      message: `Product '${cleanName}' updated successfully.`
    });
  } catch (err) {
    console.error('[Update Item Error]', err);
    res.status(500).json({ status: 500, message: `Failed to update product: ${err.message}` });
  }
});

// 4. POST /api/items/:id/archive (Admin only: Soft archive / restore product)
app.post('/api/items/:id/archive', requireAdmin, async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    const itemId = Number(req.params.id);
    const existing = orderItemsCatalog.find((i) => Number(i.itemId || i.itemid) === itemId);
    if (!existing) {
      return res.status(404).json({ status: 404, message: `Product #${itemId} not found.` });
    }

    const newActiveState = req.body?.active !== undefined ? (Number(req.body.active) === 1 ? 1 : 0) : (Number(existing.active) === 1 ? 0 : 1);
    const nowIso = new Date().toISOString();

    await db.query(
      `UPDATE items SET active = $1, updated_at = $2, updated_by = $3, updated_by_name = $4 WHERE item_id = $5`,
      [newActiveState, nowIso, Number(caller.id), caller.name, itemId]
    );

    const actionText = newActiveState === 1 ? 'RESTORE_ITEM' : 'ARCHIVE_ITEM';
    const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.query(
      `INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5, 'Item', $6, $7)`,
      [auditId, nowIso, Number(caller.id), caller.name, actionText, String(itemId), `${newActiveState === 1 ? 'Restored' : 'Archived'} product '${existing.itemName}' (#${itemId})`]
    );

    await refreshStateFromDb();
    res.json({
      status: 200,
      message: `Product '${existing.itemName}' ${newActiveState === 1 ? 'restored to active catalog' : 'archived successfully'}.`,
      active: newActiveState
    });
  } catch (err) {
    console.error('[Archive Item Error]', err);
    res.status(500).json({ status: 500, message: `Failed to change archive status: ${err.message}` });
  }
});

// 5. DELETE /api/items/:id (Admin only: Safe deletion check - rejects if referenced in orders)
app.delete('/api/items/:id', requireAdmin, async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    const itemId = Number(req.params.id);
    const existing = orderItemsCatalog.find((i) => Number(i.itemId || i.itemid) === itemId);
    if (!existing) {
      return res.status(404).json({ status: 404, message: `Product #${itemId} not found.` });
    }

    // Check if referenced in historical orders
    const refCheck = await db.query('SELECT COUNT(*) AS cnt FROM order_items WHERE item_id = $1', [itemId]);
    const refCount = Number(refCheck.rows[0]?.cnt || 0);
    if (refCount > 0) {
      return res.status(400).json({
        status: 400,
        message: `Cannot delete product '${existing.itemName}' (#${itemId}) because it is referenced in ${refCount} past customer order line(s). Please archive it instead to preserve order records.`,
        referencedInOrders: true
      });
    }

    await db.withTransaction(async (tx) => {
      await tx.query('DELETE FROM cluster_item_prices WHERE item_id = $1', [itemId]);
      await tx.query('DELETE FROM price_history WHERE item_id = $1', [itemId]);
      await tx.query('DELETE FROM items WHERE item_id = $1', [itemId]);
    });

    const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.query(
      `INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, 'DELETE_ITEM', 'Item', $5, $6)`,
      [auditId, new Date().toISOString(), Number(caller.id), caller.name, String(itemId), `Deleted unreferenced product '${existing.itemName}' (#${itemId})`]
    );

    await refreshStateFromDb();
    res.json({
      status: 200,
      message: `Product '${existing.itemName}' deleted successfully.`
    });
  } catch (err) {
    console.error('[Delete Item Error]', err);
    res.status(500).json({ status: 500, message: `Failed to delete product: ${err.message}` });
  }
});

// 6. POST /api/items/price (Update daily wholesale price with scope validation & concurrent-edit conflict detection)
app.post('/api/items/price', async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({ status: 401, message: 'Authentication required: valid Bearer session token must be provided.' });
    }

    const callerRole = (caller.role || '').toLowerCase();
    const isAdmin = callerRole === 'admin';
    const isManager = callerRole === 'sales manager';

    if (!isAdmin && !isManager) {
      return res.status(403).json({ status: 403, message: 'Permission Denied: Updating daily commodity prices requires Administrator or Sales Manager role.' });
    }

    const {
      itemId,
      clusterId = 0,
      newPrice,
      effectiveDate,
      basePrice,
      baseUpdatedAt,
      forceOverwrite = false,
      idempotencyKey = null
    } = req.body || {};

    const targetItemId = Number(itemId);
    const effCluster = Number(clusterId || 0);

    const targetItem = orderItemsCatalog.find((i) => Number(i.itemId || i.itemid) === targetItemId);
    if (!targetItem) {
      return res.status(404).json({ status: 404, message: `Product #${targetItemId} not found.` });
    }

    const numPrice = parseFloat(newPrice);
    if (isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({ status: 400, message: 'Price must be a valid non-negative number (e.g. ₹55.50).' });
    }

    // Role-Scoped Authorization
    const authorizedClusterIds = getAuthorizedClusterIds(caller);
    if (effCluster === 0) {
      // Global baseline price modification is strictly Administrator only
      if (!isAdmin) {
        return res.status(403).json({
          status: 403,
          message: 'Access Denied: Sales Managers cannot modify global catalog base prices. Only regional cluster prices can be updated.'
        });
      }
    } else {
      // Cluster-specific price: must be within the manager's authorized supervision scope
      if (!isAdmin && !authorizedClusterIds.includes(effCluster)) {
        return res.status(403).json({
          status: 403,
          message: `Access Denied: Cluster #${effCluster} is outside your regional supervision scope (Authorized clusters: ${authorizedClusterIds.join(', ') || 'none'}).`
        });
      }
    }

    // Idempotency check: if already processed, return idempotent replay
    if (idempotencyKey) {
      const existingIdemp = await db.query(
        'SELECT id, new_price, effective_date, created_at FROM price_history WHERE idempotency_key = $1',
        [String(idempotencyKey).trim()]
      );
      if (existingIdemp.rowCount > 0) {
        return res.json({
          status: 200,
          message: 'Daily price already recorded (idempotent replay).',
          idempotentReplay: true,
          itemId: targetItemId,
          clusterId: effCluster,
          price: Number(existingIdemp.rows[0].new_price),
          effectiveDate: existingIdemp.rows[0].effective_date
        });
      }
    }

    // Concurrent Edit Conflict Detection
    if (!forceOverwrite && baseUpdatedAt) {
      let currentPriceRow = null;
      if (effCluster > 0) {
        const q = await db.query(
          'SELECT price, updated_at, updated_by_name FROM cluster_item_prices WHERE cluster_id = $1 AND item_id = $2',
          [effCluster, targetItemId]
        );
        if (q.rowCount > 0) currentPriceRow = q.rows[0];
      } else {
        const q = await db.query(
          'SELECT price, updated_at, updated_by_name FROM items WHERE item_id = $1',
          [targetItemId]
        );
        if (q.rowCount > 0) currentPriceRow = q.rows[0];
      }

      if (currentPriceRow && currentPriceRow.updated_at) {
        const serverTime = new Date(currentPriceRow.updated_at).getTime();
        const baseTime = new Date(baseUpdatedAt).getTime();
        const serverPriceNum = Number(currentPriceRow.price);
        const basePriceNum = Number(basePrice);

        if (serverTime > baseTime && Math.abs(serverPriceNum - basePriceNum) > 0.001) {
          return res.status(409).json({
            status: 409,
            conflict: true,
            message: `Concurrent edit conflict: The price for ${targetItem.itemName} was updated on the server to ₹${serverPriceNum} by ${currentPriceRow.updated_by_name || 'another user'} while you were working offline.`,
            serverPrice: serverPriceNum,
            serverUpdatedAt: currentPriceRow.updated_at,
            serverUpdatedByName: currentPriceRow.updated_by_name || 'System',
            clientPrice: numPrice,
            clientEffectiveDate: effectiveDate || new Date().toISOString().slice(0, 10),
            itemId: targetItemId,
            clusterId: effCluster
          });
        }
      }
    }

    const nowIso = new Date().toISOString();
    const effDate = (effectiveDate || nowIso.slice(0, 10)).trim();
    const oldPrice = effCluster > 0
      ? Number(clusterItemPrices.find((c) => Number(c.clusterId) === effCluster && Number(c.itemId) === targetItemId)?.price ?? targetItem.price ?? 0)
      : Number(targetItem.price ?? 0);

    const priceHistoryId = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await db.withTransaction(async (tx) => {
      if (effCluster === 0) {
        await tx.query(
          `UPDATE items
           SET price = $1, updated_at = $2, updated_by = $3, updated_by_name = $4
           WHERE item_id = $5`,
          [numPrice, nowIso, Number(caller.id), caller.name, targetItemId]
        );
      } else {
        const cipId = `cip-${effCluster}-${targetItemId}`;
        await tx.query(
          `INSERT INTO cluster_item_prices (id, cluster_id, item_id, price, effective_date, updated_at, updated_by, updated_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (cluster_id, item_id) DO UPDATE SET
             price = EXCLUDED.price,
             effective_date = EXCLUDED.effective_date,
             updated_at = EXCLUDED.updated_at,
             updated_by = EXCLUDED.updated_by,
             updated_by_name = EXCLUDED.updated_by_name`,
          [cipId, effCluster, targetItemId, numPrice, effDate, nowIso, Number(caller.id), caller.name]
        );
        await tx.query(
          `UPDATE items SET updated_at = $1 WHERE item_id = $2`,
          [nowIso, targetItemId]
        );
      }

      await tx.query(
        `INSERT INTO price_history (id, item_id, cluster_id, old_price, new_price, effective_date, created_at, changed_by, changed_by_name, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [priceHistoryId, targetItemId, effCluster, oldPrice, numPrice, effDate, nowIso, Number(caller.id), caller.name, idempotencyKey || null]
      );

      const clusterObj = clusters.find((c) => Number(c.clusterId) === effCluster);
      const clusterLabel = effCluster === 0 ? 'Global Base Catalog' : (clusterObj?.clusterName || `Cluster #${effCluster}`);
      const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await tx.query(
        `INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details)
         VALUES ($1, $2, $3, $4, 'UPDATE_DAILY_PRICE', 'ItemPrice', $5, $6)`,
        [auditId, nowIso, Number(caller.id), caller.name, String(targetItemId), `Changed daily price for '${targetItem.itemName}' in ${clusterLabel} from ₹${oldPrice} to ₹${numPrice} (effective: ${effDate})`]
      );
    });

    await refreshStateFromDb();
    res.json({
      status: 200,
      message: `Daily price for '${targetItem.itemName}' updated to ₹${numPrice}.`,
      itemId: targetItemId,
      clusterId: effCluster,
      newPrice: numPrice,
      oldPrice,
      effectiveDate: effDate,
      updatedAt: nowIso,
      updatedByName: caller.name
    });
  } catch (err) {
    console.error('[Update Item Price Error]', err);
    res.status(500).json({ status: 500, message: `Failed to update daily price: ${err.message}` });
  }
});

// 7. GET /api/items/:id/history (Auditable price history timeline for an item)
app.get('/api/items/:id/history', async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({ status: 401, message: 'Authentication required' });
    }

    const callerRole = (caller.role || '').toLowerCase();
    const isAdmin = callerRole === 'admin';
    const isManager = callerRole === 'sales manager';

    if (!isAdmin && !isManager) {
      return res.status(403).json({ status: 403, message: 'Access Denied: Administrator or Sales Manager role required.' });
    }

    const itemId = Number(req.params.id);
    const authorizedClusterIds = getAuthorizedClusterIds(caller);

    const historyRes = await db.query(
      `SELECT * FROM price_history WHERE item_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [itemId]
    );

    const filtered = historyRes.rows.filter((r) => {
      const cid = Number(r.cluster_id || 0);
      if (isAdmin) return true;
      if (cid === 0) return true;
      return authorizedClusterIds.includes(cid);
    }).map((r) => {
      const cid = Number(r.cluster_id || 0);
      const c = clusters.find((cl) => Number(cl.clusterId) === cid);
      return {
        id: r.id,
        itemId: Number(r.item_id),
        clusterId: cid,
        clusterName: cid === 0 ? 'Global Base Catalog' : (c?.clusterName || `Cluster #${cid}`),
        oldPrice: Number(r.old_price),
        newPrice: Number(r.new_price),
        effectiveDate: r.effective_date,
        createdAt: r.created_at,
        changedBy: Number(r.changed_by),
        changedByName: r.changed_by_name || 'System'
      };
    });

    res.json({
      status: 200,
      itemId,
      history: filtered
    });
  } catch (err) {
    console.error('[Price History Error]', err);
    res.status(500).json({ status: 500, message: `Failed to load price history: ${err.message}` });
  }
});

// ============================================================================
// CUSTOMER-SPECIFIC PRICE REQUESTS & APPROVAL CONTROLS
// ============================================================================

function canCallerAccessPriceRequest(caller, pr) {
  if (!caller || !pr) return false;
  const role = (caller.role || '').toLowerCase();
  if (role === 'admin') return true;
  if (role === 'sales manager') {
    const assignedAgentIds = getAssignedAgentIds(caller.id);
    if (assignedAgentIds.includes(Number(pr.agentId))) return true;
    const shop = shops.find((s) => Number(s.shopid) === Number(pr.shopId));
    if (shop && canCallerAccessShop(caller, shop)) return true;
    const callerClusterId = Number(caller.cluster_id || caller.clusterid || 0);
    if (callerClusterId > 0 && callerClusterId === Number(pr.clusterId)) return true;
    return false;
  }
  if (role === 'field sales agent') {
    return Number(pr.agentId) === Number(caller.id);
  }
  return false;
}

// 1. GET /api/price-requests (List price requests scoped by role & assignments)
app.get('/api/price-requests', async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({ status: 401, message: 'Authentication required' });
    }

    const callerRole = (caller.role || '').toLowerCase();
    const isAdmin = callerRole === 'admin';
    const isManager = callerRole === 'sales manager';
    const isAgent = callerRole === 'field sales agent';

    if (!isAdmin && !isManager && !isAgent) {
      return res.status(403).json({ status: 403, message: 'Access Denied: Role cannot view price requests.' });
    }

    let list = priceRequestsList.filter((pr) => canCallerAccessPriceRequest(caller, pr));

    const statusFilter = req.query.status;
    if (statusFilter && statusFilter !== 'all') {
      list = list.filter((pr) => pr.status === statusFilter);
    }

    const enriched = list.map((pr) => {
      const sh = shops.find((s) => Number(s.shopid) === Number(pr.shopId));
      const it = orderItemsCatalog.find((i) => Number(i.itemId || i.itemid) === Number(pr.itemId)) ||
                 defaultOrderItems.find((i) => Number(i.itemId || i.itemid) === Number(pr.itemId));
      const ag = salesPersons.find((u) => Number(u.id) === Number(pr.agentId));
      const cl = clusters.find((c) => Number(c.clusterId || c.clusterid) === Number(pr.clusterId));
      const decider = pr.decisionBy ? salesPersons.find((u) => Number(u.id) === Number(pr.decisionBy)) : null;
      return {
        ...pr,
        shopName: sh?.shopName || `Shop #${pr.shopId}`,
        itemName: it?.itemName || `Item #${pr.itemId}`,
        agentName: ag?.name || `Agent #${pr.agentId}`,
        clusterName: cl?.clusterName || `Cluster #${pr.clusterId}`,
        decisionByRole: decider?.role || null,
        approvalRule: 'single'
      };
    });

    res.json({
      status: 200,
      approvalRule: 'single',
      priceRequests: enriched,
      pendingCount: enriched.filter((pr) => pr.status === 'pending').length
    });
  } catch (err) {
    console.error('[Get Price Requests Error]', err);
    res.status(500).json({ status: 500, message: `Failed to load price requests: ${err.message}` });
  }
});

// 2. POST /api/price-requests/:id/decision (Single-step resolution by either Admin or authorized Sales Manager)
const handlePriceRequestDecision = async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({ status: 401, message: 'Authentication required' });
    }

    const callerRole = (caller.role || '').toLowerCase();
    const isAdmin = callerRole === 'admin';
    const isManager = callerRole === 'sales manager';

    if (!isAdmin && !isManager) {
      return res.status(403).json({
        status: 403,
        message: 'Access Denied: Only Administrators and Sales Managers can approve or reject price requests.'
      });
    }

    const requestId = String(req.params.id);
    const pr = priceRequestsList.find((r) => String(r.id) === requestId);
    if (!pr) {
      return res.status(404).json({ status: 404, message: `Price request '${requestId}' not found.` });
    }

    // Enforce self-approval prevention
    if (Number(caller.id) === Number(pr.agentId)) {
      return res.status(403).json({
        status: 403,
        message: 'Self-approval is strictly forbidden. Agents cannot approve their own price requests.'
      });
    }

    // Enforce manager assignment scope (agent/shop/cluster scope)
    if (isManager) {
      if (!canCallerAccessPriceRequest(caller, pr)) {
        return res.status(403).json({
          status: 403,
          message: `Access Denied: Price request #${requestId} is outside your assigned team and shop scope.`
        });
      }
    }

    const { action, status, comment, applyToCatalog } = req.body || {};
    let decisionAction = String(action || status || '').toLowerCase();
    if (req.path.endsWith('/approve')) decisionAction = 'approve';
    if (req.path.endsWith('/reject')) decisionAction = 'reject';

    if (!['approve', 'approved', 'reject', 'rejected'].includes(decisionAction)) {
      return res.status(400).json({
        status: 400,
        message: "Decision action must be 'approve' or 'reject'."
      });
    }

    const isApprove = decisionAction === 'approve' || decisionAction === 'approved';
    const finalStatus = isApprove ? 'approved' : 'rejected';

    // Single approval rule: if already resolved, do not require or allow a second conflicting step
    if (pr.status === 'approved' || pr.status === 'rejected') {
      const decider = pr.decisionBy ? salesPersons.find((u) => Number(u.id) === Number(pr.decisionBy)) : null;
      if (pr.status === finalStatus) {
        return res.status(200).json({
          status: 200,
          message: `Price request is already ${pr.status}.`,
          idempotentReplay: true,
          requestId,
          orderId: pr.orderId,
          decision: pr.status,
          approvalRule: 'single',
          decidedBy: pr.decisionByName || decider?.name || `User #${pr.decisionBy}`,
          decidedByRole: decider?.role || null,
          decidedAt: pr.decisionAt
        });
      }
      return res.status(409).json({
        status: 409,
        message: `Price request '${requestId}' was already ${pr.status} by ${pr.decisionByName || 'an authorized reviewer'}. One approval or rejection resolves the request.`
      });
    }

    const nowIso = new Date().toISOString();
    const decComment = comment ? String(comment).trim() : '';

    let recalculatedTotal = 0;
    let remainingPending = 0;

    await db.withTransaction(async (tx) => {
      // 1. Update price_requests table (single decision immediately resolves request)
      await tx.query(
        `UPDATE price_requests
         SET status = $1, decision_by = $2, decision_by_name = $3, decision_at = $4, decision_comment = $5, apply_to_catalog = $6
         WHERE id = $7`,
        [finalStatus, Number(caller.id), caller.name || `User ${caller.id}`, nowIso, decComment, applyToCatalog ? 1 : 0, requestId]
      );

      // 2. Update order_items table (columns + item_json) for this order and item
      const existingItemRows = await tx.query(
        'SELECT id, item_json FROM order_items WHERE order_id = $1 AND item_id = $2',
        [pr.orderId, pr.itemId]
      );
      for (const itemRow of (existingItemRows.rows || [])) {
        let parsedJson = {};
        try {
          parsedJson = JSON.parse(itemRow.item_json || '{}');
        } catch {}
        const updatedJson = {
          ...parsedJson,
          catalogPrice: Number(parsedJson.catalogPrice || pr.catalogPrice || parsedJson.price || 0),
          price: isApprove ? Number(pr.requestedPrice) : Number(pr.catalogPrice || parsedJson.catalogPrice || parsedJson.price || 0),
          custprice: isApprove ? Number(pr.requestedPrice) : Number(pr.catalogPrice || parsedJson.catalogPrice || parsedJson.price || 0),
          actprice: isApprove ? Number(pr.requestedPrice) : Number(pr.catalogPrice || parsedJson.catalogPrice || parsedJson.price || 0),
          requestedPrice: Number(pr.requestedPrice),
          priceRequestStatus: finalStatus,
          decisionBy: Number(caller.id),
          decisionByName: caller.name || `User ${caller.id}`,
          decisionByRole: caller.role || (isAdmin ? 'Admin' : 'Sales Manager'),
          decisionAt: nowIso
        };
        if (isApprove) {
          await tx.query(
            `UPDATE order_items
             SET price = $1, cust_price = $1, act_price = $1, price_request_status = 'approved', item_json = $2
             WHERE id = $3`,
            [pr.requestedPrice, JSON.stringify(updatedJson), itemRow.id]
          );
        } else {
          await tx.query(
            `UPDATE order_items
             SET price_request_status = 'rejected', item_json = $1
             WHERE id = $2`,
            [JSON.stringify(updatedJson), itemRow.id]
          );
        }
      }

      // 3. Recalculate total of order_items for this order
      const orderItemsRows = await tx.query(
        'SELECT qty, price FROM order_items WHERE order_id = $1',
        [pr.orderId]
      );
      recalculatedTotal = Number(
        orderItemsRows.rows.reduce(
          (sum, row) => sum + (Number(row.qty) || 0) * (Number(row.price) || 0),
          0
        ).toFixed(2)
      );

      // 4. Check if there are any remaining pending price requests for other items on this order
      const pendingCheck = await tx.query(
        "SELECT COUNT(*) AS cnt FROM price_requests WHERE order_id = $1 AND status = 'pending' AND id != $2",
        [pr.orderId, requestId]
      );
      remainingPending = Number(pendingCheck.rows[0]?.cnt || 0);

      // If no more pending requests for this order, transition order status to 'In progress'
      if (remainingPending === 0) {
        await tx.query(
          `UPDATE orders
           SET total = $1, payment_balance_due = $1 - COALESCE(payment_amount_collected, 0), status = 'In progress'
           WHERE order_id = $2 AND status = 'Price approval pending'`,
          [recalculatedTotal, pr.orderId]
        );
      } else {
        await tx.query(
          'UPDATE orders SET total = $1, payment_balance_due = $1 - COALESCE(payment_amount_collected, 0) WHERE order_id = $2',
          [recalculatedTotal, pr.orderId]
        );
      }

      // 5. If applyToCatalog requested and authorized, update cluster item price
      if (applyToCatalog && isApprove) {
        const authClusters = getAuthorizedClusterIds(caller);
        if (isAdmin || (isManager && authClusters.includes(Number(pr.clusterId)))) {
          const clusterPriceId = `cp-${pr.clusterId}-${pr.itemId}`;
          const effDate = nowIso.slice(0, 10);
          await tx.query(
            `INSERT INTO cluster_item_prices (id, cluster_id, item_id, price, effective_date, updated_at, updated_by, updated_by_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (cluster_id, item_id) DO UPDATE
             SET price = EXCLUDED.price, effective_date = EXCLUDED.effective_date, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name`,
            [clusterPriceId, pr.clusterId, pr.itemId, pr.requestedPrice, effDate, nowIso, Number(caller.id), caller.name]
          );
        }
      }
    });

    await refreshStateFromDb();
    await addAuditLog(
      req,
      'PRICE_REQUEST_DECISION',
      'PriceRequest',
      requestId,
      `${isApprove ? 'Approved' : 'Rejected'} price request ${requestId} for order ${pr.orderId} (Item: ${pr.itemId}, Req: ₹${pr.requestedPrice}, Cat: ₹${pr.catalogPrice}) by ${caller.name} (${caller.role})${decComment ? ` [Note: ${decComment}]` : ''}`
    );

    res.json({
      status: 200,
      message: `Price request ${finalStatus} successfully.`,
      requestId,
      orderId: pr.orderId,
      orderStatus: remainingPending === 0 ? 'In progress' : 'Price approval pending',
      orderTotal: recalculatedTotal,
      decision: finalStatus,
      approvalRule: 'single',
      decidedBy: caller.name,
      decidedByRole: caller.role,
      decidedAt: nowIso
    });
  } catch (err) {
    console.error('[Price Request Decision Error]', err);
    res.status(500).json({ status: 500, message: `Failed to record price decision: ${err.message}` });
  }
};

app.post('/api/price-requests/:id/decision', handlePriceRequestDecision);
app.post('/api/price-requests/:id/approve', handlePriceRequestDecision);
app.post('/api/price-requests/:id/reject', handlePriceRequestDecision);

// ============================================================================
// SALES MANAGER & REGIONAL ENDPOINTS (Role-Scoped & Governed)
// ============================================================================

app.get('/api/manager/assignments', async (req, res) => {
  await refreshStateFromDb();
  const reqManagerId = req.query.managerId || req.query.spersonId;
  const auth = authorizeManagerAccess(req, res, reqManagerId);
  if (!auth.authorized) return;

  const managerId = auth.effectiveManagerId;
  const assignedAgentIds = getAssignedAgentIds(managerId);
  const assignedAgents = salesPersons
    .filter((s) => assignedAgentIds.includes(Number(s.id)))
    .map(({ passwordHash, ...rest }) => rest);
  const allAgents = salesPersons
    .filter((s) => (s.role || '').toLowerCase() !== 'sales manager' && (s.role || '').toLowerCase() !== 'admin')
    .map(({ passwordHash, ...rest }) => rest);

  res.json({
    status: 200,
    managerId,
    assignedAgentIds,
    assignedAgents,
    allAgents,
    isAdmin: (auth.caller?.role || '').toLowerCase() === 'admin'
  });
});

app.post('/api/manager/assignments', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const targetManagerId = Number(req.body?.managerId);
  if (!targetManagerId) {
    return res.status(400).json({ status: 400, message: 'Missing target managerId.' });
  }

  const targetManager = salesPersons.find((u) => Number(u.id) === targetManagerId);
  if (!targetManager || (targetManager.role || '').toLowerCase() !== 'sales manager') {
    return res.status(400).json({
      status: 400,
      message: `Invalid target manager: User #${targetManagerId} is not an active Sales Manager.`
    });
  }

  const agentIds = Array.isArray(req.body?.agentIds) ? req.body.agentIds.map(Number) : [];

  await db.withTransaction(async (tx) => {
    await tx.query('DELETE FROM manager_assignments WHERE manager_id = $1', [targetManagerId]);
    for (const agId of agentIds) {
      await tx.query(
        'INSERT INTO manager_assignments (manager_id, agent_id) VALUES ($1, $2) ON CONFLICT (manager_id, agent_id) DO NOTHING',
        [targetManagerId, agId]
      );
    }
  });

  await refreshStateFromDb();
  await addAuditLog(req, 'ASSIGNMENTS_UPDATE', 'ManagerAssignment', targetManagerId, `Assigned agents [${agentIds.join(', ')}] to Manager #${targetManagerId}`);

  const assignedAgents = salesPersons
    .filter((s) => agentIds.includes(Number(s.id)))
    .map(({ passwordHash, ...rest }) => rest);

  res.json({
    status: 200,
    message: 'Assignments updated successfully by Administrator',
    managerId: targetManagerId,
    assignedAgentIds: agentIds,
    assignedAgents
  });
});

app.get(['/api/manager/assigned-agents', '/api/manager/:managerId/assigned-agents'], async (req, res) => {
  await refreshStateFromDb();
  const reqManagerId = req.params.managerId || req.query.managerId || req.query.spersonId;
  const auth = authorizeManagerAccess(req, res, reqManagerId);
  if (!auth.authorized) return;

  const managerId = auth.effectiveManagerId;
  const assignedAgentIds = getAssignedAgentIds(managerId);
  const assignedAgents = salesPersons
    .filter((s) => assignedAgentIds.includes(Number(s.id)))
    .map(({ passwordHash, ...rest }) => rest);

  res.json({
    status: 200,
    managerId,
    agents: assignedAgents,
    assignedAgents
  });
});

// Visit photo for one order (photos are not included in list responses)
app.get('/api/orders/:id/visit-photo', requireAuth, async (req, res) => {
  const caller = getCaller(req);
  const orderId = String(req.params.id || '').slice(0, 64);
  const r = await db.query(
    'SELECT order_id, sperson_id, delivery_agent_id, visit_photo, visit_photo_updated_at FROM orders WHERE order_id = $1',
    [orderId]
  );
  if (r.rowCount === 0) {
    return res.status(404).json({ status: 404, message: 'Order not found.' });
  }
  const row = r.rows[0];
  const role = (caller.role || '').toLowerCase();
  const allowed =
    role === 'admin' ||
    (role === 'field sales agent' && Number(row.sperson_id) === Number(caller.id)) ||
    (role === 'delivery agent' && Number(row.delivery_agent_id) === Number(caller.id)) ||
    (role === 'sales manager' && getAssignedAgentIds(caller.id).includes(Number(row.sperson_id)));
  if (!allowed) {
    return res.status(403).json({ status: 403, message: 'Access Denied: you cannot view this order.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({
    status: 200,
    orderId: row.order_id,
    hasVisitPhoto: Boolean(row.visit_photo),
    visitPhoto: row.visit_photo || null,
    visitPhotoUpdatedAt: row.visit_photo_updated_at || null
  });
});

// Standard Authenticated Orders Endpoint for Field Sales Agents, Managers, and Admins
app.get('/api/orders', requireAuth, async (req, res) => {
  await refreshStateFromDb();
  const caller = getCaller(req);
  if (!caller) return res.status(401).json({ status: 401, message: 'Authentication required' });

  const callerRole = (caller.role || '').toLowerCase();
  let orders = [];

  if (callerRole === 'admin') {
    orders = submittedOrders;
  } else if (callerRole === 'sales manager') {
    const assignedAgentIds = getAssignedAgentIds(caller.id);
    orders = submittedOrders.filter((o) => assignedAgentIds.includes(Number(o.spersonid)));
  } else if (callerRole === 'delivery agent') {
    // Same assignment field as GET /api/delivery/orders (orders.delivery_agent_id)
    orders = submittedOrders.filter((o) => o.deliveryAgentId !== null && o.deliveryAgentId !== undefined && Number(o.deliveryAgentId) === Number(caller.id));
  } else if (callerRole === 'field sales agent') {
    // Field Sales Agent: strictly scoped to caller.id
    orders = submittedOrders.filter((o) => Number(o.spersonid) === Number(caller.id));
  } else {
    // T0.2: other roles were treated as Field Sales Agents
    return res.status(403).json({ status: 403, message: 'Access Denied: your role cannot list orders.' });
  }

  const { status, limit } = req.query;
  let filtered = [...orders];
  if (status && status !== 'all') {
    filtered = filtered.filter((o) => (o.status || '').toLowerCase() === status.toLowerCase());
  }

  filtered.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.orderId || b.id || '').localeCompare(a.orderId || a.id || ''));

  if (limit) {
    filtered = filtered.slice(0, Number(limit));
  }

  const formatted = filtered.map((o) => {
    const dStr = String(o.date || o.orderDate || '').slice(0, 10);
    return {
      id: o.orderId || o.id,
      orderId: o.orderId || o.id,
      customer: o.shopName || o.customer || 'Shop',
      shopName: o.shopName || o.customer || 'Shop',
      shopCategory: o.shopCategory || 'Retail',
      shopid: o.shopid || o.customerId || o.shopId,
      customerId: o.shopid || o.customerId || o.shopId,
      date: o.date || o.orderDate,
      expectedDeliveryDate: o.expectedDeliveryDate || (dStr ? addDaysToDateStr(dStr, 1) : null),
      itemsCount: (o.orderList || []).length || o.itemsCount || 0,
      total: Number(o.total || 0),
      status: o.status || 'In progress',
      clusterId: o.clusterId,
      spersonid: o.spersonid,
      agentName: o.agentName || '',
      deliveryAgentId: o.deliveryAgentId,
      locationLat: o.locationLat ?? null,
      locationLng: o.locationLng ?? null,
      locationAccuracy: o.locationAccuracy ?? null,
      locationText: o.locationText || null,
      visitPhoto: null, // fetch with GET /api/orders/:id/visit-photo
      hasVisitPhoto: Boolean(o.hasVisitPhoto),
      visitPhotoStatus: o.visitPhotoStatus || null,
      visitPhotoUpdatedAt: o.visitPhotoUpdatedAt || null,
      paymentStatus: o.paymentStatus || 'Not collected',
      paymentAmountCollected: Number(o.paymentAmountCollected || 0),
      paymentBalanceDue: o.paymentBalanceDue !== undefined && o.paymentBalanceDue !== null
        ? Number(o.paymentBalanceDue)
        : Math.max(0, Number(o.total || 0) - Number(o.paymentAmountCollected || 0)),
      paymentCollectedAt: o.paymentCollectedAt || null,
      paymentCollectedBy: o.paymentCollectedBy || null,
      paymentCollectedByName: o.paymentCollectedByName || null,
      orderList: o.orderList || []
    };
  });

  res.json({
    status: 200,
    orders: formatted
  });
});

// ============================================================================
// ADMIN AUDITED ORDER MANAGEMENT CRUD ENDPOINTS
// ============================================================================

// 1. POST /api/admin/orders (Admin create order)
app.post('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    const { shopId, spersonId, clusterId, orderDate, orderList, notes } = req.body || {};

    const shop = shops.find((s) => Number(s.shopid) === Number(shopId) || String(s.shopid) === String(shopId));
    if (!shop) {
      return res.status(400).json({ status: 400, message: `Invalid shopId: Shop '${shopId}' not found.` });
    }

    const lines = Array.isArray(orderList) ? orderList.filter((i) => (parseFloat(i.qty) || 0) > 0) : [];
    if (lines.length === 0) {
      return res.status(400).json({ status: 400, message: 'Order must contain at least one line item with quantity > 0.' });
    }

    // T0.6 (R12): an explicit spersonId must be an active sales user; without one the admin is credited (unchanged)
    let agent = caller;
    if (spersonId !== undefined && spersonId !== null && spersonId !== '') {
      const credited = findCreditableSalesperson(spersonId);
      if (!credited.ok) {
        return res.status(400).json({
          status: 400,
          code: 'INVALID_CREDITED_SALESPERSON',
          message: `The order cannot be credited to user #${spersonId}: the user ${credited.reason}.`
        });
      }
      agent = credited.user;
    }
    const finalClusterId = Number(clusterId || shop.clusterid || 1);
    const dateStr = orderDate && /^\d{4}-\d{2}-\d{2}$/.test(orderDate) ? orderDate : getIstDateString();
    const expectedDeliveryDate = req.body?.expectedDeliveryDate && /^\d{4}-\d{2}-\d{2}$/.test(req.body.expectedDeliveryDate)
      ? req.body.expectedDeliveryDate
      : addDaysToDateStr(dateStr, 1);
    const nowIso = new Date().toISOString();

    let newOrderId = '';
    let newSerial = 0;
    let orderTotal = 0;

    await db.withTransaction(async (tx) => {
      await db.lockAllocation(tx, 'orders');
      await db.lockAllocation(tx, 'order_items');
      const serialRes = await tx.query('SELECT COALESCE(MAX(serial_no), 24000) + 1 AS next_serial FROM orders');
      newSerial = Number(serialRes.rows[0].next_serial);
      newOrderId = `S${String(shop.shopid).padStart(3, '0')}-${newSerial}`;

      // 1. Calculate order total and prepare line items
      const preparedLines = [];
      for (const line of lines) {
        const itemRecord = (orderItemsCatalog || []).find((it) => Number(it.itemId) === Number(line.itemid || line.itemId));
        const itemName = itemRecord ? itemRecord.itemName : (line.itemName || `Item ${line.itemid}`);
        const price = parseFloat(line.custprice ?? line.price ?? itemRecord?.price ?? 0);
        const qty = parseFloat(line.qty) || 0;
        const lineTotal = qty * price;
        orderTotal += lineTotal;
        preparedLines.push({
          itemId: Number(line.itemid || line.itemId),
          itemName,
          price,
          qty,
          line
        });
      }

      // 2. Insert parent order first (to satisfy foreign key constraints)
      await tx.query(
        `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name, cluster_id, order_date, expected_delivery_date, created_at, status, items_count, total, payment_status, payment_amount_collected, payment_balance_due)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'In progress', $13, $14, 'Not collected', 0, $14)`,
        [
          newOrderId,
          newSerial,
          `S${String(shop.shopid).padStart(3, '0')}`,
          Number(shop.shopid),
          shop.shopName,
          shop.shopCategory || 'Retail',
          Number(agent.id),
          agent.name || `User ${agent.id}`,
          finalClusterId,
          dateStr,
          expectedDeliveryDate,
          nowIso,
          preparedLines.length,
          orderTotal
        ]
      );

      // 3. Insert order line items
      let nextItemIdRes = await tx.query('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM order_items');
      let nextItemId = Number(nextItemIdRes.rows[0].next_id);

      for (const p of preparedLines) {
        await tx.query(
          `INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, item_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            nextItemId++,
            newOrderId,
            p.itemId,
            p.itemName,
            p.qty,
            p.price,
            p.price,
            p.price,
            JSON.stringify({ ...p.line, itemName: p.itemName, price: p.price, qty: p.qty })
          ]
        );
      }
    });

    await refreshStateFromDb();
    await addAuditLog(
      req,
      'ORDER_CREATED',
      'Order',
      newOrderId,
      `Admin created order ${newOrderId} for shop '${shop.shopName}' (Total: ₹${orderTotal}, Lines: ${lines.length})${notes ? ` [Note: ${notes}]` : ''}`
    );

    const createdOrder = submittedOrders.find((o) => o.orderId === newOrderId || o.id === newOrderId);
    res.json({
      status: 200,
      message: 'Order created successfully',
      orderId: newOrderId,
      order: createdOrder
    });
  } catch (err) {
    console.error('[Admin Order Create Error]', err);
    res.status(500).json({ status: 500, message: `Failed to create order: ${err.message}` });
  }
});

// 2. PUT /api/admin/orders/:id (Admin edit order, quantities, prices, status, delivery agent)
app.put('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    await refreshStateFromDb();
    const caller = getCaller(req);
    const targetOrderId = String(req.params.id);
    const order = submittedOrders.find((o) => String(o.id) === targetOrderId || String(o.orderId) === targetOrderId);
    if (!order) {
      return res.status(404).json({ status: 404, message: `Order '${targetOrderId}' not found.` });
    }

    const { status, deliveryAgentId, orderList, notes } = req.body || {};
    const beforeStatus = effectiveStatus(order.status);
    const beforeTotal = order.total;
    const beforeLinesCount = (order.orderList || []).length;

    let newStatus = status ? String(status).trim() : beforeStatus;
    if (newStatus !== beforeStatus) {
      if (!isRecognisedStatus(newStatus)) {
        return res.status(400).json({
          status: 400,
          message: `Unknown status '${newStatus}' is not allowed. Use one of: ${ORDER_STATUSES.join(', ')}.`
        });
      }
      const transition = checkTransition(beforeStatus, newStatus, 'admin');
      if (!transition.ok) {
        return res.status(409).json(
          conflictBody({ orderId: order.orderId, currentStatus: beforeStatus, requestedStatus: newStatus, message: transition.message })
        );
      }
    }
    let newDeliveryAgentId = deliveryAgentId !== undefined
      ? (deliveryAgentId === null || deliveryAgentId === '' ? null : Number(deliveryAgentId))
      : order.deliveryAgentId;

    let newTotal = order.total;
    let newLinesCount = (order.orderList || []).length;
    const hasNewLines = Array.isArray(orderList) && orderList.length > 0;

    await db.withTransaction(async (tx) => {
      if (hasNewLines) {
        await db.lockAllocation(tx, 'order_items');
        // Delete old line items
        await tx.query('DELETE FROM order_items WHERE order_id = $1', [order.orderId]);

        let nextItemIdRes = await tx.query('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM order_items');
        let nextItemId = Number(nextItemIdRes.rows[0].next_id);
        newTotal = 0;

        for (const line of orderList) {
          const qty = parseFloat(line.qty) || 0;
          if (qty <= 0) continue;
          const itemRecord = (orderItemsCatalog || []).find((it) => Number(it.itemId) === Number(line.itemid || line.itemId));
          const itemName = line.itemName || itemRecord?.itemName || `Item ${line.itemid}`;
          const price = parseFloat(line.custprice ?? line.price ?? line.actprice ?? itemRecord?.price ?? 0);
          newTotal += qty * price;

          await tx.query(
            `INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, item_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              nextItemId++,
              order.orderId,
              Number(line.itemid || line.itemId),
              itemName,
              qty,
              price,
              price,
              price,
              JSON.stringify({ ...line, itemName, price, qty })
            ]
          );
        }
        newLinesCount = orderList.filter((l) => (parseFloat(l.qty) || 0) > 0).length;
      }

      // Applies only if nobody changed the status since it was read; otherwise the whole edit
      // (line items included) is rolled back and the admin gets a 409.
      const write = await updateOrderIfStatus(
        tx,
        order.orderId,
        beforeStatus,
        `status = $1, delivery_agent_id = $2, total = $3, items_count = $4`,
        [newStatus, newDeliveryAgentId, newTotal, newLinesCount]
      );
      if (!write.applied) {
        const err = new Error('STATUS_CONFLICT');
        err.statusConflict = write.currentStatus;
        throw err;
      }
    });

    await refreshStateFromDb();
    await addAuditLog(
      req,
      'ORDER_UPDATED',
      'Order',
      order.orderId,
      `Admin updated order ${order.orderId}: status '${beforeStatus}' -> '${newStatus}', total ₹${beforeTotal} -> ₹${newTotal}, lines ${beforeLinesCount} -> ${newLinesCount}${notes ? ` [Note: ${notes}]` : ''}`
    );

    const updatedOrder = submittedOrders.find((o) => o.orderId === order.orderId || o.id === order.orderId);
    res.json({
      status: 200,
      message: 'Order updated successfully',
      order: updatedOrder
    });
  } catch (err) {
    if (err && err.statusConflict !== undefined) {
      await refreshStateFromDb();
      const orderId = String(req.params.id);
      return res.status(409).json(
        conflictBody({
          orderId,
          currentStatus: err.statusConflict,
          requestedStatus: req.body?.status ? String(req.body.status).trim() : err.statusConflict,
          message: `Order '${orderId}' changed to '${err.statusConflict}' while it was being edited. Nothing was saved; reload and try again.`
        })
      );
    }
    console.error('[Admin Order Update Error]', err);
    res.status(500).json({ status: 500, message: `Failed to update order: ${err.message}` });
  }
});

// 3. POST /api/admin/orders/:id/cancel (Admin cancel order)
app.post('/api/admin/orders/:id/cancel', requireAdmin, async (req, res) => {
  try {
    await refreshStateFromDb();
    const targetOrderId = String(req.params.id);
    const order = submittedOrders.find((o) => String(o.id) === targetOrderId || String(o.orderId) === targetOrderId);
    if (!order) {
      return res.status(404).json({ status: 404, message: `Order '${targetOrderId}' not found.` });
    }

    const reason = req.body?.reason ? String(req.body.reason).trim() : 'Cancelled by Administrator';
    const beforeStatus = effectiveStatus(order.status);

    if (beforeStatus === 'Cancelled') {
      return res.json({
        status: 200,
        message: `Order '${order.orderId}' is already cancelled.`,
        orderId: order.orderId,
        idempotentReplay: true
      });
    }

    // Ordinary cancellation only before pick-up; payment columns are never touched here.
    const transition = checkTransition(beforeStatus, 'Cancelled', 'admin');
    if (!transition.ok) {
      return res.status(409).json(
        conflictBody({ orderId: order.orderId, currentStatus: beforeStatus, requestedStatus: 'Cancelled', message: transition.message })
      );
    }

    const write = await updateOrderIfStatus(db, order.orderId, beforeStatus, `status = $1`, ['Cancelled']);
    if (!write.applied) {
      await refreshStateFromDb();
      if (write.currentStatus === 'Cancelled') {
        return res.json({ status: 200, message: `Order '${order.orderId}' is already cancelled.`, orderId: order.orderId, idempotentReplay: true });
      }
      return res.status(409).json(
        conflictBody({
          orderId: order.orderId,
          currentStatus: write.currentStatus,
          requestedStatus: 'Cancelled',
          message: `Order '${order.orderId}' changed to '${write.currentStatus}' before it could be cancelled. It was not cancelled.`
        })
      );
    }

    await refreshStateFromDb();
    await addAuditLog(
      req,
      'ORDER_CANCELLED',
      'Order',
      order.orderId,
      `Admin cancelled order ${order.orderId} (previous status: '${beforeStatus}'). Reason: ${reason}`
    );

    res.json({
      status: 200,
      message: `Order '${order.orderId}' cancelled successfully.`,
      orderId: order.orderId,
      status: 'Cancelled'
    });
  } catch (err) {
    console.error('[Admin Order Cancel Error]', err);
    res.status(500).json({ status: 500, message: `Failed to cancel order: ${err.message}` });
  }
});

// 4. DELETE /api/admin/orders/:id (Admin delete order permanently)
app.delete('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    await refreshStateFromDb();
    const targetOrderId = String(req.params.id);
    const order = submittedOrders.find((o) => String(o.id) === targetOrderId || String(o.orderId) === targetOrderId);
    if (!order) {
      return res.status(404).json({ status: 404, message: `Order '${targetOrderId}' not found.` });
    }

    await db.withTransaction(async (tx) => {
      await tx.query('DELETE FROM price_requests WHERE order_id = $1', [order.orderId]);
      await tx.query('DELETE FROM order_items WHERE order_id = $1', [order.orderId]);
      await tx.query('DELETE FROM orders WHERE order_id = $1', [order.orderId]);
    });

    await refreshStateFromDb();
    await addAuditLog(
      req,
      'ORDER_DELETED',
      'Order',
      order.orderId,
      `Admin permanently deleted order ${order.orderId} (Shop: ${order.customer}, Total: ₹${order.total})`
    );

    res.json({
      status: 200,
      message: `Order '${order.orderId}' permanently deleted.`,
      orderId: order.orderId
    });
  } catch (err) {
    console.error('[Admin Order Delete Error]', err);
    res.status(500).json({ status: 500, message: `Failed to delete order: ${err.message}` });
  }
});

app.get('/api/manager/orders', async (req, res) => {
  await refreshStateFromDb();
  const reqManagerId = req.query.managerId;
  const auth = authorizeManagerAccess(req, res, reqManagerId);
  if (!auth.authorized) return;

  const callerRole = auth.caller?.role || 'Sales Manager';
  if (!checkActionPermission(callerRole, 'view_team_orders')) {
    return res.status(403).json({
      status: 403,
      message: 'Permission Denied: Viewing orders has been disabled for your role by an Administrator.'
    });
  }

  const managerId = auth.effectiveManagerId;
  const assignedAgentIds = getAssignedAgentIds(managerId);

  const reqAgentId = req.query.agentId;
  const clusterId = req.query.clusterId;
  const fromDate = req.query.fromDate;
  const toDate = req.query.toDate;
  const status = req.query.status;
  const category = req.query.category;
  const shopId = req.query.shopId;

  if (assignedAgentIds.length === 0) {
    return res.json({
      status: 200,
      orders: [],
      totals: { count: 0, totalAmount: 0, totalUnits: 0, averageOrderValue: 0 }
    });
  }

  if (reqAgentId && reqAgentId !== 'all') {
    const targetId = Number(reqAgentId);
    if (!assignedAgentIds.includes(targetId)) {
      return res.status(403).json({
        status: 403,
        message: 'Access Denied: Agent is not assigned to this manager.',
        orders: [],
        totals: { count: 0, totalAmount: 0, totalUnits: 0, averageOrderValue: 0 }
      });
    }
  }

  const allowedAgentIds = (reqAgentId && reqAgentId !== 'all')
    ? [Number(reqAgentId)]
    : assignedAgentIds;

  const filtered = submittedOrders.filter((o) => {
    if (!allowedAgentIds.includes(Number(o.spersonid))) return false;
    if (fromDate && o.date < fromDate) return false;
    if (toDate && o.date > toDate) return false;
    if (clusterId && clusterId !== 'all' && Number(o.clusterId) !== Number(clusterId)) return false;
    if (category && category !== 'all' && (o.shopCategory || '').toLowerCase() !== category.toLowerCase()) return false;
    if (shopId && shopId !== 'all' && String(o.customerId) !== String(shopId) && String(o.shopId) !== String(shopId)) return false;
    if (status && status !== 'all' && (o.status || '').toLowerCase() !== status.toLowerCase()) return false;
    return true;
  });

  const totalAmount = filtered.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalUnits = filtered.reduce((sum, o) => {
    const units = (o.orderList || []).reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
    return sum + (units || o.itemsCount || 0);
  }, 0);
  const count = filtered.length;
  const averageOrderValue = count > 0 ? Math.round(totalAmount / count) : 0;

  res.json({
    status: 200,
    orders: filtered,
    totals: {
      count,
      totalAmount,
      totalUnits,
      averageOrderValue
    }
  });
});

app.get('/api/manager/reports', async (req, res) => {
  await refreshStateFromDb();
  const reqManagerId = req.query.managerId;
  const auth = authorizeManagerAccess(req, res, reqManagerId);
  if (!auth.authorized) return;

  const callerRole = auth.caller?.role || 'Sales Manager';
  const isAdmin = (callerRole || '').toLowerCase() === 'admin';
  if (!checkActionPermission(callerRole, 'view_team_reports')) {
    return res.status(403).json({
      status: 403,
      message: 'Permission Denied: Viewing reports has been disabled for your role by an Administrator.'
    });
  }

  const managerId = auth.effectiveManagerId;
  const managerUser = salesPersons.find((s) => Number(s.id) === Number(managerId)) || auth.caller;
  const assignedAgentIds = getAssignedAgentIds(managerId);
  const authorizedClusterIds = isAdmin
    ? clusters.map((c) => Number(c.clusterId))
    : getAuthorizedClusterIds(managerUser);

  // Filter to active Field Sales Agents for sales performance and targets
  const fieldSalesAgentIds = assignedAgentIds.filter((aid) => {
    const u = salesPersons.find((s) => Number(s.id) === Number(aid));
    return u && (u.role || '').toLowerCase() === 'field sales agent' && Number(u.active) === 1;
  });

  const reqAgentId = req.query.agentId;
  const clusterId = req.query.clusterId;
  const hasPeriodOrDates = Boolean(req.query.period || req.query.range || req.query.fromDate || req.query.startDate || req.query.toDate || req.query.endDate);
  const periodInfo = resolveReportPeriodRange(req.query);
  const fromDate = hasPeriodOrDates ? periodInfo.fromDate : null;
  const toDate = hasPeriodOrDates ? periodInfo.toDate : null;

  if (clusterId && clusterId !== 'all' && !isAdmin) {
    if (!authorizedClusterIds.includes(Number(clusterId))) {
      return res.status(403).json({
        status: 403,
        message: `Access Denied: Cluster #${clusterId} is outside your assigned supervision scope.`
      });
    }
  }

  const authorizedClusters = clusters.filter((c) => authorizedClusterIds.includes(Number(c.clusterId)));

  if (fieldSalesAgentIds.length === 0 && assignedAgentIds.length === 0) {
    return res.json({
      status: 200,
      report: {
        timezone: 'Asia/Kolkata',
        periodInfo,
        hasTarget: false,
        targetAmount: 0,
        achievedAmount: 0,
        differenceAmount: 0,
        targetGap: 0,
        achievementRate: 0,
        achievementPct: 0,
        performanceIndicator: getPerformanceIndicator(0, false),
        performanceIndicatorScale: PERFORMANCE_INDICATOR_SCALE,
        shopCounts: { assignedShopsCount: 0, visitedShopsCount: 0, orderedShopsCount: 0, notOrderedShopsCount: 0 },
        frequentlyOrderedCustomers: {
          rule: 'At least 1 order every 2 days within the selected period',
          periodLabel: periodInfo.periodLabel,
          calculationPeriod: `${periodInfo.fromDate} to ${periodInfo.toDate} (${periodInfo.periodDays} days)`,
          fromDate: periodInfo.fromDate,
          toDate: periodInfo.toDate,
          periodDays: periodInfo.periodDays,
          minOrdersRequired: Math.max(1, Math.ceil(periodInfo.periodDays / 2)),
          count: 0,
          customers: []
        },
        itemBreakdown: [],
        agentBreakdown: [],
        dailyComparison: [],
        dailyDeliveryStatus: [],
        authorizedClusters,
        unassigned: true
      }
    });
  }

  if (reqAgentId && reqAgentId !== 'all') {
    const targetId = Number(reqAgentId);
    if (!assignedAgentIds.includes(targetId)) {
      return res.status(403).json({
        status: 403,
        message: 'Access Denied: Agent is not assigned to this manager.'
      });
    }
  }

  const targetAgentIds = (reqAgentId && reqAgentId !== 'all')
    ? [Number(reqAgentId)]
    : (fieldSalesAgentIds.length > 0 ? fieldSalesAgentIds : assignedAgentIds);

  // All orders in agent/cluster scope (used for dailyDeliveryStatus drill-down across previous days)
  const scopeOrdersAllDates = submittedOrders.filter((o) => {
    if (!targetAgentIds.includes(Number(o.spersonid))) return false;
    if (clusterId && clusterId !== 'all' && Number(o.clusterId) !== Number(clusterId)) return false;
    if (!isAdmin && !authorizedClusterIds.includes(Number(o.clusterId))) return false;
    return String(o.status || '').toLowerCase() !== 'cancelled';
  });

  // Orders filtered by selected period / date range
  const orders = scopeOrdersAllDates.filter((o) => {
    const dStr = String(o.date || '').slice(0, 10);
    if (fromDate && dStr < fromDate) return false;
    if (toDate && dStr > toDate) return false;
    return true;
  });

  // Scoped shops for this manager / filter
  const scopedShops = shops.filter((s) => {
    const sCid = Number(s.clusterid || s.cluster_id);
    if (clusterId && clusterId !== 'all' && sCid !== Number(clusterId)) return false;
    if (!isAdmin && !authorizedClusterIds.includes(sCid)) return false;
    const assignedId = Number(s.assignedAgentId || s.assigned_agent_id || 0);
    const createdId = Number(s.createdby || s.created_by || 0);
    if (reqAgentId && reqAgentId !== 'all') {
      return assignedId === Number(reqAgentId);
    }
    return targetAgentIds.includes(assignedId) || targetAgentIds.includes(createdId) || authorizedClusterIds.includes(sCid);
  });

  const orderedShopIds = new Set(
    orders.map((o) => Number(o.customerId || o.shopid || 0)).filter((id) => id > 0)
  );
  const shopCounts = {
    assignedShopsCount: scopedShops.length,
    visitedShopsCount: orderedShopIds.size,
    orderedShopsCount: orderedShopIds.size,
    notOrderedShopsCount: Math.max(0, scopedShops.length - orderedShopIds.size)
  };

  const achievedAmount = Number(orders.reduce((sum, o) => sum + Number(o.total || 0), 0).toFixed(2));

  const catalogSource = orderItemsCatalog.length > 0 ? orderItemsCatalog : defaultOrderItems;
  const itemAchievedMap = {};
  catalogSource.forEach((item) => {
    const iid = Number(item.itemId || item.itemid);
    itemAchievedMap[iid] = {
      itemId: iid,
      itemName: item.itemName,
      unit: String(item.unitType || 'kg').toLowerCase().startsWith('kg') ? 'kg' : String(item.unitType || 'kg'),
      price: Number(item.price || 0),
      achievedQty: 0,
      achievedValue: 0
    };
  });

  orders.forEach((o) => {
    (o.orderList || []).forEach((item) => {
      const id = Number(item.itemid || item.itemId);
      const qty = parseFloat(item.qty) || 0;
      if (id <= 0 || qty <= 0) return;
      const price = parseFloat(item.price || item.custprice || item.actprice || 50);
      if (!itemAchievedMap[id]) {
        itemAchievedMap[id] = {
          itemId: id,
          itemName: item.itemName || `Item ${id}`,
          unit: 'kg',
          price,
          achievedQty: 0,
          achievedValue: 0
        };
      }
      itemAchievedMap[id].achievedQty += qty;
      itemAchievedMap[id].achievedValue += qty * price;
    });
  });

  const matchedTargets = salesTargets.filter((t) => {
    if (!targetAgentIds.includes(Number(t.agentId))) return false;
    if (clusterId && clusterId !== 'all' && Number(t.clusterId) !== Number(clusterId)) return false;
    return true;
  });

  const hasTarget = matchedTargets.length > 0;
  let targetAmount = 0;
  const itemTargetMap = {};

  if (hasTarget) {
    matchedTargets.forEach((t) => {
      targetAmount += Number(t.targetAmount || 0);
      (t.itemTargets || []).forEach((it) => {
        const id = Number(it.itemId);
        if (!itemTargetMap[id]) {
          itemTargetMap[id] = { targetQty: 0, targetAmount: 0 };
        }
        itemTargetMap[id].targetQty += Number(it.targetQty || 0);
        itemTargetMap[id].targetAmount += Number(it.targetAmount || 0);
      });
    });
  }

  const itemBreakdown = Object.values(itemAchievedMap).map((ach) => {
    const tgt = itemTargetMap[ach.itemId] || { targetQty: 0, targetAmount: 0 };
    const targetQty = Number(tgt.targetQty || 0);
    const targetVal = Number(tgt.targetAmount || 0);
    const qtyGap = Math.max(0, targetQty - ach.achievedQty);
    const valueGap = Math.max(0, targetVal - ach.achievedValue);
    const differenceQty = Number((ach.achievedQty - targetQty).toFixed(2));
    const differenceValue = Number((ach.achievedValue - targetVal).toFixed(2));
    const itemHasTarget = targetQty > 0 || targetVal > 0;
    const achievementPct = targetVal > 0
      ? Number(((ach.achievedValue / targetVal) * 100).toFixed(1))
      : (targetQty > 0 ? Number(((ach.achievedQty / targetQty) * 100).toFixed(1)) : 0);

    return {
      itemId: ach.itemId,
      itemName: ach.itemName,
      unit: ach.unit || 'kg',
      price: ach.price,
      targetQty,
      achievedQty: Number(ach.achievedQty.toFixed(2)),
      differenceQty,
      qtyGap: Number(qtyGap.toFixed(2)),
      targetValue: Number(targetVal.toFixed(2)),
      achievedValue: Number(ach.achievedValue.toFixed(2)),
      differenceValue,
      valueGap: Number(valueGap.toFixed(2)),
      achievementPct,
      performanceIndicator: getPerformanceIndicator(achievementPct, itemHasTarget),
      hasTarget: itemHasTarget
    };
  });

  // Agent-level Target vs Actual breakdown (strictly Field Sales Agents)
  const agentBreakdown = targetAgentIds.map((aid) => {
    const ag = salesPersons.find((s) => Number(s.id) === Number(aid));
    const agTargets = matchedTargets.filter((t) => Number(t.agentId) === Number(aid));
    const agTargetAmt = agTargets.reduce((s, t) => s + Number(t.targetAmount || 0), 0);
    const agOrders = orders.filter((o) => Number(o.spersonid) === Number(aid));
    const agActualAmt = Number(agOrders.reduce((s, o) => s + Number(o.total || 0), 0).toFixed(2));
    const agDiffAmt = Number((agActualAmt - agTargetAmt).toFixed(2));
    const agAchPct = agTargetAmt > 0 ? Number(((agActualAmt / agTargetAmt) * 100).toFixed(1)) : 0;
    const agAssignedShops = shops.filter((s) => Number(s.assignedAgentId || s.assigned_agent_id) === Number(aid)).length;
    const agOrderedShops = new Set(agOrders.map((o) => Number(o.customerId || o.shopid || 0)).filter((id) => id > 0)).size;
    return {
      agentId: Number(aid),
      agentName: ag ? ag.name : `Agent #${aid}`,
      role: ag ? ag.role : 'Field Sales Agent',
      clusterId: ag ? ag.clusterid : 1,
      assignedShopsCount: agAssignedShops,
      orderedShopsCount: agOrderedShops,
      ordersCount: agOrders.length,
      targetAmount: Number(agTargetAmt.toFixed(2)),
      actualAmount: agActualAmt,
      differenceAmount: agDiffAmt,
      achievementPct: agAchPct,
      performanceIndicator: getPerformanceIndicator(agAchPct, agTargetAmt > 0)
    };
  });

  const targetGap = hasTarget ? Math.max(0, Number((targetAmount - achievedAmount).toFixed(2))) : 0;
  const differenceAmount = Number((achievedAmount - targetAmount).toFixed(2));
  const achievementPct = hasTarget && targetAmount > 0
    ? Number(((achievedAmount / targetAmount) * 100).toFixed(1))
    : 0;
  const achievementRate = hasTarget && targetAmount > 0
    ? Math.min(100, Math.round((achievedAmount / targetAmount) * 100))
    : 0;
  const performanceIndicator = getPerformanceIndicator(achievementPct, hasTarget && targetAmount > 0);

  const todayISO = getIstDateString();
  const yestISO = addDaysToDateStr(todayISO, -1);

  const todayAchieved = orders
    .filter((o) => String(o.date || '').slice(0, 10) === todayISO)
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const yestAchieved = orders
    .filter((o) => String(o.date || '').slice(0, 10) === yestISO)
    .reduce((sum, o) => sum + Number(o.total || 0), 0);

  const dailyComparison = [
    { label: 'Yesterday', date: yestISO, achieved: yestAchieved, target: hasTarget ? Math.round(targetAmount / 2) : 0 },
    { label: 'Today', date: todayISO, achieved: todayAchieved, target: hasTarget ? Math.round(targetAmount / 2) : 0 }
  ];

  // Daily delivery status across scopeOrdersAllDates so selecting an In Progress count for a previous day opens matching orders
  const dailyMap = new Map();
  for (const o of scopeOrdersAllDates) {
    const dStr = String(o.date || '').slice(0, 10);
    if (!dStr) continue;
    const expDeliv = o.expectedDeliveryDate || addDaysToDateStr(dStr, 1);
    if (!dailyMap.has(dStr)) {
      dailyMap.set(dStr, {
        date: dStr,
        expectedDeliveryDate: expDeliv,
        totalOrders: 0,
        deliveredCount: 0,
        inProgressCount: 0,
        pendingApprovalCount: 0,
        totalQty: 0,
        deliveredQty: 0,
        inProgressQty: 0,
        inProgressOrders: []
      });
    }
    const dayEntry = dailyMap.get(dStr);
    dayEntry.totalOrders += 1;
    const st = String(o.status || '').toLowerCase();
    const isDeliv = st === 'delivered';
    const isPend = st === 'price approval pending';
    const activeLines = (Array.isArray(o.orderList) ? o.orderList : [])
      .filter((l) => (parseFloat(l.qty) || 0) > 0)
      .map((l) => ({
        itemid: l.itemid || l.itemId,
        itemName: l.itemName || l.description || l.name || `Item ${l.itemid || l.itemId}`,
        description: l.itemName || l.description || l.name || `Item ${l.itemid || l.itemId}`,
        qty: parseFloat(l.qty) || 0,
        unit: String(l.unitType || l.unit || 'kg').toLowerCase().startsWith('kg') ? 'kg' : String(l.unitType || l.unit || 'kg'),
        price: parseFloat(l.price || l.custprice || l.actprice || 0),
        requestedPrice: l.requestedPrice !== undefined && l.requestedPrice !== null ? parseFloat(l.requestedPrice) : null,
        priceRequestStatus: l.priceRequestStatus || null
      }));
    const orderQty = activeLines.reduce((s, l) => s + l.qty, 0);
    dayEntry.totalQty = Number((dayEntry.totalQty + orderQty).toFixed(2));
    if (isDeliv) {
      dayEntry.deliveredCount += 1;
      dayEntry.deliveredQty = Number((dayEntry.deliveredQty + orderQty).toFixed(2));
    } else {
      if (isPend) dayEntry.pendingApprovalCount += 1;
      dayEntry.inProgressCount += 1;
      dayEntry.inProgressQty = Number((dayEntry.inProgressQty + orderQty).toFixed(2));
      dayEntry.inProgressOrders.push({
        orderId: o.orderId || o.id,
        id: o.id || o.orderId,
        shopId: o.shopId || `S${String(o.customerId || '').padStart(3, '0')}`,
        customerId: o.customerId || o.shopid,
        shopName: o.shopName || o.customer || 'Shop',
        shopCategory: o.shopCategory || 'Retail',
        agentName: o.agentName || '',
        spersonid: o.spersonid,
        date: dStr,
        expectedDeliveryDate: expDeliv,
        status: o.status || 'In progress',
        total: Number(o.total || 0),
        totalQty: Number(orderQty.toFixed(2)),
        itemsCount: activeLines.length,
        locationText: o.locationText || null,
        visitPhotoStatus: o.visitPhotoStatus || null,
        orderList: activeLines
      });
    }
  }
  const dailyDeliveryStatus = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));

  const frequentlyOrderedCustomers = computeFrequentlyOrderedCustomers(orders, scopedShops, periodInfo);

  res.json({
    status: 200,
    report: {
      timezone: 'Asia/Kolkata',
      periodInfo,
      hasTarget,
      targetAmount: Number(targetAmount.toFixed(2)),
      achievedAmount,
      differenceAmount,
      targetGap,
      achievementRate,
      achievementPct,
      performanceIndicator,
      performanceIndicatorScale: PERFORMANCE_INDICATOR_SCALE,
      shopCounts,
      frequentlyOrderedCustomers,
      itemBreakdown,
      agentBreakdown,
      dailyComparison,
      dailyDeliveryStatus,
      authorizedClusters,
      ordersCount: orders.length
    }
  });
});

app.get('/api/manager/targets', async (req, res) => {
  await refreshStateFromDb();
  const reqManagerId = req.query.managerId;
  const auth = authorizeManagerAccess(req, res, reqManagerId);
  if (!auth.authorized) return;

  const managerId = auth.effectiveManagerId;
  const assignedAgentIds = getAssignedAgentIds(managerId);
  const filtered = salesTargets.filter((t) => assignedAgentIds.includes(Number(t.agentId)));
  res.json({ status: 200, targets: filtered });
});

app.post('/api/manager/targets', async (req, res) => {
  await refreshStateFromDb();
  const targetManagerId = req.body?.managerId;
  const auth = authorizeManagerAccess(req, res, targetManagerId);
  if (!auth.authorized) return;

  const managerId = auth.effectiveManagerId;
  const assignedAgentIds = getAssignedAgentIds(managerId);
  const agentId = Number(req.body?.agentId);

  if (!assignedAgentIds.includes(agentId)) {
    return res.status(403).json({
      status: 403,
      message: 'Forbidden: Cannot configure targets for unassigned agents.'
    });
  }

  const { clusterId, period, targetAmount, itemTargets } = req.body || {};
  const targetPeriod = (period || new Date().toISOString().slice(0, 7)).trim();
  const amt = Number(targetAmount || 0);
  const effCluster = Number(clusterId || 1);
  const itemsArr = Array.isArray(itemTargets) ? itemTargets : [];
  const nowIso = new Date().toISOString();

  let savedTargetId = 0;
  await db.withTransaction(async (tx) => {
    await db.lockAllocation(tx, 'sales_targets');
    const existing = await tx.query(
      'SELECT id FROM sales_targets WHERE agent_id = $1 AND period = $2',
      [agentId, targetPeriod]
    );
    if (existing.rowCount > 0) {
      savedTargetId = Number(existing.rows[0].id);
      await tx.query(
        `UPDATE sales_targets
         SET manager_id = $1, cluster_id = $2, target_amount = $3, item_targets_json = $4, updated_at = $5, updated_by = $6
         WHERE id = $7`,
        [managerId, effCluster, amt, JSON.stringify(itemsArr), nowIso, Number(auth.caller.id), savedTargetId]
      );
    } else {
      const maxRes = await tx.query('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sales_targets');
      savedTargetId = Number(maxRes.rows[0]?.next_id || 1);
      await tx.query(
        `INSERT INTO sales_targets (id, agent_id, manager_id, cluster_id, period, target_amount, item_targets_json, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [savedTargetId, agentId, managerId, effCluster, targetPeriod, amt, JSON.stringify(itemsArr), nowIso, Number(auth.caller.id)]
      );
    }
  });

  await refreshStateFromDb();
  await addAuditLog(req, 'TARGET_SET', 'SalesTarget', savedTargetId, `Manager #${managerId} configured target for agent #${agentId}`);

  const savedTarget = salesTargets.find((t) => Number(t.id) === savedTargetId);
  res.json({ status: 200, message: 'Target saved successfully', target: savedTarget });
});

app.get('/api/manager/shops', async (req, res) => {
  await refreshStateFromDb();
  const caller = getCaller(req);
  if (!caller) {
    return res.status(401).json({
      status: 401,
      message: 'Authentication required: valid Bearer session token must be provided.'
    });
  }

  const callerRole = (caller.role || '').toLowerCase();
  const isAdmin = callerRole === 'admin';

  let targetManagerId = req.query.managerId;
  if (!isAdmin) {
    const auth = authorizeManagerAccess(req, res, targetManagerId);
    if (!auth.authorized) return;
    targetManagerId = auth.effectiveManagerId;
  }

  if (!checkActionPermission(caller.role || 'Sales Manager', 'view_cluster_shops')) {
    return res.status(403).json({
      status: 403,
      message: 'Permission Denied: Viewing cluster shops has been disabled for your role by an Administrator.'
    });
  }

  const clusterId = req.query.clusterId;
  const fromDate = req.query.fromDate;
  const toDate = req.query.toDate;

  const clusterShops = shops.filter((s) => {
    if (clusterId && clusterId !== 'all' && Number(s.clusterid) !== Number(clusterId)) return false;
    return true;
  });

  let relevantOrders = [];
  const reqManagerId = req.query.managerId;
  const specificManager = reqManagerId && reqManagerId !== 'all'
    ? salesPersons.find((s) => Number(s.id) === Number(reqManagerId) && (s.role || '').toLowerCase() === 'sales manager')
    : null;

  if (isAdmin && !specificManager) {
    relevantOrders = submittedOrders.filter((o) => {
      if (fromDate && o.date < fromDate) return false;
      if (toDate && o.date > toDate) return false;
      return true;
    });
  } else {
    const managerId = specificManager ? specificManager.id : Number(targetManagerId);
    const assignedAgentIds = getAssignedAgentIds(managerId);
    relevantOrders = submittedOrders.filter((o) => {
      if (!assignedAgentIds.includes(Number(o.spersonid))) return false;
      if (fromDate && o.date < fromDate) return false;
      if (toDate && o.date > toDate) return false;
      return true;
    });
  }

  const enriched = clusterShops.map((shop) => {
    const shopOrders = relevantOrders.filter((o) =>
      Number(o.customerId) === Number(shop.shopid) ||
      (o.shopId && String(o.shopId).replace(/^S0*/, '') === String(shop.shopid))
    );

    const hasOrdered = shopOrders.length > 0;
    const orderCount = shopOrders.length;
    const orderTotal = shopOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const latestOrder = hasOrdered ? shopOrders[0] : null;

    const lat = parseFloat(shop.latitude);
    const lng = parseFloat(shop.longitude);
    const hasValidCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0 && lat >= 8 && lat <= 14 && lng >= 76 && lng <= 80;

    const creatorAgent = salesPersons.find((s) => Number(s.id) === Number(shop.createdby));
    const rawAid = shop.assignedAgentId !== undefined && shop.assignedAgentId !== null
      ? shop.assignedAgentId
      : (shop.assigned_agent_id !== undefined && shop.assigned_agent_id !== null ? shop.assigned_agent_id : null);
    const assignedAgentId = rawAid !== null && !isNaN(Number(rawAid)) && Number(rawAid) > 0 ? Number(rawAid) : null;
    const assignedAgent = assignedAgentId ? salesPersons.find((s) => Number(s.id) === assignedAgentId) : null;

    return {
      shopid: shop.shopid,
      clusterid: shop.clusterid,
      shopName: shop.shopName,
      shopCategory: shop.shopCategory || 'Retail',
      ownerName: shop.ownerName || '',
      contact1: shop.contact1 || '',
      address: shop.address || '',
      pincode: shop.pincode || '',
      photoUrl: shop.photo && shop.photo !== 'no_image.jpg' && shop.photo.startsWith('shop_')
        ? `/api/uploads/shops/${shop.photo}`
        : null,
      latitude: hasValidCoords ? lat : null,
      longitude: hasValidCoords ? lng : null,
      hasValidCoords,
      hasOrdered,
      orderCount,
      orderTotal,
      latestOrder: latestOrder ? {
        id: latestOrder.id,
        date: latestOrder.date,
        total: latestOrder.total,
        status: latestOrder.status,
        itemsCount: latestOrder.itemsCount
      } : null,
      creatorAgent: creatorAgent ? { id: creatorAgent.id, name: creatorAgent.name } : null,
      assignedAgentId: assignedAgentId,
      assignedAgent: assignedAgent ? { id: assignedAgent.id, name: assignedAgent.name } : null
    };
  });

  const total = enriched.length;
  const orderedCount = enriched.filter((s) => s.hasOrdered).length;
  const notOrderedCount = total - orderedCount;
  const validCount = enriched.filter((s) => s.hasValidCoords).length;
  const unmappedCount = total - validCount;

  res.json({
    status: 200,
    shops: enriched,
    summary: {
      total,
      orderedCount,
      notOrderedCount,
      validCount,
      unmappedCount
    }
  });
});

// GPS-verified shop visits and shop coordinate management (Migration 007)
registerVisitRoutes(app, {
  db,
  getCaller,
  refreshStateFromDb,
  getShops: () => shops,
  getUsers: () => salesPersons,
  getAppSettings: () => appSettings,
  getAssignedAgentIds,
  checkActionPermission,
  addAuditLog,
  getIstDateString,
  addDaysToDateStr,
  logEvent
});

// SPA fallback for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ status: 404, message: 'API route not found.' });
  }
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Global error handler (multer size limit, JSON parse errors, and every failed async route)
app.use(errorMiddleware);

// Initialize Database, Run Repeatable Migrations, and Start HTTP Server
async function startServer() {
  installProcessHandlers();
  // Refuse to start if a declared route was never registered
  routeAccess.assertComplete();
  await db.init();
  const migResult = await runMigrationsAndSeed({
    seedData,
    legacyAdminConfigPath: adminConfigFilePath,
    hashPassword,
    verifyPassword,
    isProduction,
    defaultRolePermissions: DEFAULT_ROLE_PERMISSIONS
  });
  invalidPhoneAccounts = migResult.invalidPhoneAccounts || [];

  // In development mode, ensure canonical demo role accounts are seeded with test credentials
  if (!isProduction) {
    await ensureDevelopmentDemoAccounts();
  }

  await refreshStateFromDb();

  if (invalidPhoneAccounts.length > 0) {
    console.warn(`[Security WARNING] ${invalidPhoneAccounts.length} user account(s) require a valid 10-digit Indian mobile number before they can sign in.`);
  }

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`LineCart Server running on http://localhost:${port}`);
  });

  const handleShutdown = async (signal) => {
    console.log(`[Server] Received ${signal}. Draining HTTP requests and closing database connection pool...`);
    server.close(() => {
      console.log('[Server] HTTP listener closed.');
    });
    try {
      await db.close();
      console.log('[DB] Database pool closed successfully.');
    } catch (closeErr) {
      console.error('[DB] Error closing pool:', closeErr?.message || closeErr);
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
  process.once('SIGINT', () => handleShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('[Fatal Startup Error]', err);
  process.exit(1);
});
