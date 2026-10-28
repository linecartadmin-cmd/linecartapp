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
  INDIAN_MOBILE_REGEX
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment Configuration Loader (.env reader without third-party deps)
const loadEnvFile = () => {
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
    pages: ['reports', 'orders', 'map', 'team', 'customers', 'items'],
    actions: ['view_team_reports', 'export_reports', 'export_png', 'view_team_orders', 'view_cluster_shops', 'view_team', 'view_items', 'update_daily_prices']
  },
  'Field Sales Agent': {
    pages: ['overview', 'orders', 'reports', 'customers', 'summary'],
    actions: ['view_agent_reports', 'create_order', 'view_assigned_shops', 'add_customer', 'view_summary']
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

function extractBearerToken(req) {
  if (!req || !req.headers) return null;
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const sessionHeader = req.headers['x-session-token'] || req.headers['x-token'];
  if (typeof sessionHeader === 'string' && sessionHeader.trim()) {
    return sessionHeader.trim();
  }
  return null;
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

  const rawToken = extractBearerToken(req);
  if (!rawToken) {
    req._resolvedCaller = null;
    return null;
  }

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
      await db.query(
        `INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success)
         VALUES (COALESCE((SELECT MAX(id) FROM login_attempts), 0) + 1, $1, $2, $3, 0)`,
        [String(phoneKey || 'unknown').slice(0, 32), String(ipAddress || 'unknown'), Date.now()]
      );
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
 * - Sales Manager: their cluster plus clusters of their assigned field agents.
 * - Field Sales Agent / Delivery Agent: their assigned cluster.
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
    const ownCluster = Number(caller.clusterid || 1);
    return Array.from(new Set([ownCluster, ...assignedClusters]));
  }
  return [Number(caller.clusterid || 1)];
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
const port = process.env.PORT || 3001;

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token, X-Idempotency-Key');
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

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Safe Request Logger (NEVER logs passwords, tokens, or sensitive query parameters)
app.use((req, res, next) => {
  if (req.url.startsWith('http://freshcubes.in')) {
    req.url = req.url.replace('http://freshcubes.in', '');
  }
  const safePath = req.path || req.url.split('?')[0];
  console.log(`[${new Date().toISOString()}] ${req.method} ${safePath}`);
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

// Cloud & Service Health Check Endpoint (public, lightweight, verified against live database)
app.get(['/health', '/api/health'], async (req, res) => {
  try {
    const shopsRes = await db.query('SELECT COUNT(*) AS cnt FROM shops');
    const shopsCount = Number(shopsRes.rows[0]?.cnt || 0);
    const ordersRes = await db.query('SELECT COUNT(*) AS cnt FROM orders');
    const ordersCount = Number(ordersRes.rows[0]?.cnt || 0);
    const usersRes = await db.query('SELECT COUNT(*) AS cnt FROM users');
    const usersCount = Number(usersRes.rows[0]?.cnt || 0);

    res.json({
      status: 'healthy',
      service: 'linecart-backend',
      environment: isProduction ? (process.env.APP_ENV || 'production') : 'development',
      database: {
        mode: db.mode,
        connected: true,
        shopsCount,
        usersCount,
        ordersCount
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

// System environment & setup status endpoint (minimal public info, no private data)
app.get('/api/system/mode', async (req, res) => {
  await refreshStateFromDb();
  const activeValidAdmins = salesPersons.filter(
    (s) =>
      (s.role || '').toLowerCase() === 'admin' &&
      Number(s.active) === 1 &&
      s.phoneValid &&
      Boolean(s.passwordHash)
  );
  res.json({
    status: 200,
    production: isProduction,
    demoMode: !isProduction,
    hasActiveAdmin: activeValidAdmins.length > 0,
    requiresAdminSetup: activeValidAdmins.length === 0
  });
});

// One-time Initial Admin Setup endpoint (ONLY available when no active Admin has a valid password & mobile)
app.post('/api/system/setup-admin', async (req, res) => {
  await refreshStateFromDb();
  const activeValidAdmins = salesPersons.filter(
    (s) =>
      (s.role || '').toLowerCase() === 'admin' &&
      Number(s.active) === 1 &&
      s.phoneValid &&
      Boolean(s.passwordHash)
  );
  if (activeValidAdmins.length > 0) {
    return res.status(403).json({
      status: 403,
      message: 'Initial Administrator is already configured. Sign in as Admin to manage accounts.'
    });
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : 'LineCart Administrator';
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

  const duplicate = salesPersons.find((s) => s.phone === phone && (s.role || '').toLowerCase() !== 'admin');
  if (duplicate) {
    return res.status(400).json({
      status: 400,
      message: 'That mobile number is already assigned to another account.'
    });
  }

  const newHash = hashPassword(password);
  const existingAdmin = salesPersons.find((s) => (s.role || '').toLowerCase() === 'admin');
  let adminId = existingAdmin ? Number(existingAdmin.id) : 900;

  await db.withTransaction(async (tx) => {
    if (existingAdmin) {
      await tx.query(
        `UPDATE users
         SET name = $1, phone = $2, phone_valid = 1, password_hash = $3, must_change_password = 0, active = 1
         WHERE id = $4`,
        [name || existingAdmin.name, phone, newHash, adminId]
      );
    } else {
      await tx.query(
        `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
         VALUES ($1, $2, 'Admin', $3, 1, $4, 0, 1, 1, $5)`,
        [adminId, name, phone, newHash, new Date().toISOString().slice(0, 19).replace('T', ' ')]
      );
    }
  });

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
  if (isProduction || db.mode === 'postgres') return;

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
  if (isProduction || db.mode === 'postgres') {
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
      mustChangePassword: false
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

  await refreshStateFromDb();
  await addAuditLog(req, 'USER_PASSWORD_CHANGE', 'User', user.id, `Password changed for user ${user.name} (${user.role})`);

  res.json({
    status: 200,
    message: 'Password changed successfully.'
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
  const assignedAgentId = Number(shop.assignedAgentId ?? shop.assigned_agent_id ?? shopCreatedBy);
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
    if (assignedAgentIds.includes(assignedAgentId) || assignedAgentIds.includes(shopCreatedBy)) {
      return true;
    }
    if (callerClusterId === 0 || callerClusterId === shopClusterId) {
      return true;
    }
    const assignedAgents = salesPersons.filter((u) => assignedAgentIds.includes(Number(u.id)));
    if (assignedAgents.some((u) => Number(u.clusterid || u.cluster_id) === shopClusterId)) {
      return true;
    }
    return false;
  }

  // Field Sales Agent: authorized strictly for shops assigned to them
  if (role === 'field sales agent') {
    if (
      !checkActionPermission(caller.role, 'view_assigned_shops') &&
      !checkActionPermission(caller.role, 'view_cluster_shops') &&
      !checkActionPermission(caller.role, 'view_shops') &&
      !checkActionPermission(caller.role, 'create_order')
    ) {
      return false;
    }
    return assignedAgentId === callerId;
  }

  // Delivery Agent: authorized for shops in their assigned route cluster
  if (role === 'delivery agent') {
    if (callerClusterId === 0 || callerClusterId === shopClusterId) {
      return true;
    }
    return false;
  }

  return false;
}

// Compute live cluster statistics from real persisted database shops & orders
function computeClusterStatsForScope(clusterId, scopedOrders = null, scopedShops = null) {
  const cId = Number(clusterId);
  const clusterShops = (scopedShops !== null ? scopedShops : shops).filter(
    (s) => Number(s.clusterid || s.cluster_id) === cId
  );
  const allOrders = scopedOrders !== null ? scopedOrders : submittedOrders;

  // Non-cancelled orders for this cluster
  const clusterOrders = allOrders.filter((o) => {
    if (Number(o.clusterId || o.cluster_id) !== cId) return false;
    const st = String(o.status || '').toLowerCase();
    return st !== 'cancelled';
  });

  // Unique shops with at least one active order in this cluster
  const orderedShopIds = new Set();
  clusterOrders.forEach((o) => {
    const sId = Number(o.customerId || o.shopid || o.shopId || 0);
    if (sId > 0) orderedShopIds.add(sId);
  });

  const totalshops = clusterShops.length;
  const totalorderedshops = Math.min(totalshops, orderedShopIds.size);
  const totalnotorderedshops = Math.max(0, totalshops - totalorderedshops);

  // Group items by itemid from real persisted orderList lines
  const itemMap = new Map();

  for (const o of clusterOrders) {
    const orderStatus = String(o.status || '').toLowerCase();
    const isDelivered = orderStatus === 'delivered';
    const isPendingApproval = orderStatus === 'price approval pending';

    const lines = Array.isArray(o.orderList) ? o.orderList : [];
    for (const item of lines) {
      const itemId = Number(item.itemid || item.itemId || 0);
      if (itemId <= 0) continue;
      const itemName = String(item.itemName || item.name || `Item ${itemId}`);
      const qty = parseFloat(item.qty || 0) || 0;
      if (qty <= 0) continue;

      if (!itemMap.has(itemId)) {
        itemMap.set(itemId, {
          id: itemId,
          name: itemName,
          totalcount: 0,
          delivered: 0,
          inprogress: 0,
          pendingApproval: 0
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
      }
    }
  }

  // deliverystatus: only commodities actually ordered
  const deliverystatus = Array.from(itemMap.values()).map((rec) => ({
    id: rec.id,
    name: rec.name,
    totalcount: rec.totalcount,
    delivered: rec.delivered,
    inprogress: rec.inprogress,
    pendingApproval: rec.pendingApproval,
    fulfillment: rec.totalcount > 0 ? Math.min(100, Math.round((rec.delivered / rec.totalcount) * 100)) : 0
  }));

  // order_item_status: only commodities actually ordered
  const order_item_status = Array.from(itemMap.values()).map((rec) => ({
    id: rec.id,
    name: rec.name,
    totalcount: rec.totalcount,
    delivered: rec.delivered,
    inprogress: rec.inprogress,
    pendingApproval: rec.pendingApproval,
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
    deliverystatus,
    order_item_status,
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

  // Scoped orders
  let baseOrders = submittedOrders;
  if (callerRole === 'admin') {
    if (reqSpersonId && reqSpersonId !== 'all') {
      baseOrders = baseOrders.filter((o) => Number(o.spersonid) === Number(reqSpersonId));
    }
  } else if (callerRole === 'sales manager') {
    const assigned = getAssignedAgentIds(caller.id);
    if (reqSpersonId && reqSpersonId !== 'all') {
      if (!assigned.includes(Number(reqSpersonId))) {
        return res.status(403).json({ status: 403, message: 'Access Denied: Agent is not in your team.' });
      }
      baseOrders = baseOrders.filter((o) => Number(o.spersonid) === Number(reqSpersonId));
    } else {
      baseOrders = baseOrders.filter((o) => assigned.includes(Number(o.spersonid)));
    }
  } else {
    // Field Sales Agent: only their own orders
    baseOrders = baseOrders.filter((o) => Number(o.spersonid) === Number(effectiveSpersonId));
  }

  // Filter by date range if provided
  const fromDate = req.query.fromDate || req.query.startDate;
  const toDate = req.query.toDate || req.query.endDate;
  if (fromDate) {
    baseOrders = baseOrders.filter((o) => (o.date || '').slice(0, 10) >= fromDate);
  }
  if (toDate) {
    baseOrders = baseOrders.filter((o) => (o.date || '').slice(0, 10) <= toDate);
  }

  // Scoped shops for stats
  let scopedShops = shops;
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

  // Filter clusters if clusterId query parameter is provided
  const filterClusterId = req.query.clusterId || req.query.clusterid;
  let relevantClusters = clusters;
  if (filterClusterId && filterClusterId !== 'all') {
    const matched = clusters.filter((c) => Number(c.clusterId) === Number(filterClusterId));
    if (matched.length > 0) {
      relevantClusters = matched;
    }
  }

  // For Field Sales Agent: only show clusters containing shops assigned to this agent
  if (callerRole === 'field sales agent') {
    relevantClusters = relevantClusters.filter((c) =>
      scopedShops.some((s) => Number(s.clusterid || s.cluster_id) === Number(c.clusterId))
    );
  }

  const clusterList = relevantClusters.map((cluster) => {
    const stats = computeClusterStatsForScope(cluster.clusterId, baseOrders, scopedShops);
    return {
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      deliverystatus: stats.deliverystatus,
      order_shop_status: {
        totalshops: stats.totalshops,
        totalorderedshops: stats.totalorderedshops,
        totalnotorderedshops: stats.totalnotorderedshops
      },
      order_item_status: stats.order_item_status,
      shopsByCategory: stats.shopsByCategory
    };
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

  let scopedClusters = clusters;
  if (callerRole === 'field sales agent') {
    const assignedShops = shops.filter(
      (s) => Number(s.assignedAgentId || s.assigned_agent_id) === Number(effectiveSpersonId)
    );
    const assignedClusterIds = new Set(assignedShops.map((s) => Number(s.clusterid || s.cluster_id)));
    scopedClusters = clusters.filter((c) => assignedClusterIds.has(Number(c.clusterId)));
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
        : (customerData.assignedAgentId ? Number(customerData.assignedAgentId) : createdby);

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

  const activeCatalog = orderItemsCatalog.length > 0
    ? orderItemsCatalog.filter((item) => Number(item.active ?? 1) === 1)
    : defaultOrderItems;

  let scopedShops = shops;
  if (callerRole === 'field sales agent') {
    scopedShops = shops.filter(
      (s) => Number(s.assignedAgentId || s.assigned_agent_id) === Number(effectiveSpersonId)
    );
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

    // Verify agent identity ownership
    const requestedSpersonId = orderList[0]?.spersonid !== undefined ? Number(orderList[0].spersonid) : Number(caller.id);
    if ((callerRole || '').toLowerCase() === 'field sales agent' && requestedSpersonId !== Number(caller.id)) {
      return res.status(403).json({
        status: 403,
        message: `Access Denied: Field Sales Agents cannot submit orders on behalf of another agent (Caller ID: ${caller.id}, Requested: ${requestedSpersonId}).`
      });
    }
    if ((callerRole || '').toLowerCase() === 'sales manager') {
      const assigned = getAssignedAgentIds(caller.id);
      if (requestedSpersonId !== Number(caller.id) && !assigned.includes(requestedSpersonId)) {
        return res.status(403).json({
          status: 403,
          message: `Access Denied: Agent #${requestedSpersonId} is not assigned to your team.`
        });
      }
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
    const clusterid = parseInt(orderList[0]?.clusterid, 10) || (shop?.clusterid || Number(caller.clusterid || 1));
    const spersonid = requestedSpersonId;
    const agent = salesPersons.find((s) => Number(s.id) === Number(spersonid));

    // Validate requested prices and identify if price approval is pending
    let hasPriceRequest = false;
    for (const item of activeItems) {
      const hasReq = item.requestedPrice !== undefined && item.requestedPrice !== null && item.requestedPrice !== '';
      if (hasReq) {
        const reqPrice = parseFloat(item.requestedPrice);
        if (isNaN(reqPrice) || reqPrice < 0) {
          return res.status(400).json({
            status: 400,
            message: `Invalid requested price for item '${item.itemName || item.itemid}'. Price must be a non-negative number.`,
            id: '0'
          });
        }
        const catPrice = parseFloat(item.price || item.custprice || item.actprice || 0);
        if (Math.abs(reqPrice - catPrice) > 0.001) {
          hasPriceRequest = true;
        }
      }
    }

    const initialOrderStatus = hasPriceRequest ? 'Price approval pending' : 'In progress';

    const orderTotal = activeItems.reduce(
      (sum, item) => sum + ((parseFloat(item.qty) || 0) * (parseFloat(item.custprice || item.price || item.actprice) || 0)),
      0
    );

    const idempotencyKey = String(
      req.headers['x-idempotency-key'] || req.body?.idempotencyKey || ''
    ).trim() || null;
    const deviceEventTime = req.headers['x-device-event-time'] || req.body?.deviceEventTime || null;

    let resultPayload = null;

    await db.withTransaction(async (tx) => {
      // 1. Check explicit idempotency key
      if (idempotencyKey) {
        const existingIdemp = await tx.query(
          'SELECT order_id, serial_no, shop_short_id, status FROM orders WHERE idempotency_key = $1',
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
            priceApprovalPending: row.status === 'Price approval pending',
            idempotentReplay: true,
            deviceEventTime
          };
          return;
        }
      }

      // 2. Check rapid duplicate submission within 5 seconds (same customer, agent, total, items_count)
      const fiveSecAgoIso = new Date(Date.now() - 5000).toISOString();
      const recentDup = await tx.query(
        `SELECT order_id, serial_no, shop_short_id, status
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
      const todayDate = /^\d{4}-\d{2}-\d{2}$/.test(customDate) ? customDate : nowIso.slice(0, 10);

      // Assign default delivery agent in cluster if one exists
      const clusterDeliveryAgent = salesPersons.find(
        (u) => (u.role || '').toLowerCase() === 'delivery agent' && Number(u.active) === 1
      );
      const deliveryAgentId = clusterDeliveryAgent ? Number(clusterDeliveryAgent.id) : 50;

      await tx.query(
        `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name, cluster_id, order_date, created_at, status, items_count, total, delivery_agent_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
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
          nowIso,
          initialOrderStatus,
          activeItems.length,
          orderTotal,
          deliveryAgentId,
          idempotencyKey
        ]
      );

      const maxItemRes = await tx.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM order_items');
      let nextItemRowId = Number(maxItemRes.rows[0]?.max_id || 0);

      for (const item of orderList) {
        nextItemRowId += 1;
        const hasReq = item.requestedPrice !== undefined && item.requestedPrice !== null && item.requestedPrice !== '';
        const reqPrice = hasReq ? parseFloat(item.requestedPrice) : null;
        const catPrice = parseFloat(item.price || item.custprice || item.actprice || 0);
        const isReq = hasReq && reqPrice !== null && Math.abs(reqPrice - catPrice) > 0.001;
        const itemPriceStatus = isReq ? 'pending' : null;

        const itemName =
          item.itemName ||
          orderItemsCatalog.find((d) => Number(d.itemId || d.itemid) === Number(item.itemid))?.itemName ||
          defaultOrderItems.find((d) => Number(d.itemid) === Number(item.itemid))?.itemName ||
          `Item ${item.itemid}`;
        const enrichedLine = {
          ...item,
          itemName,
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
      month: '02-digit',
      day: '02-digit'
    }).format(now);

    const todayStr = (req.query.today && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today))
      ? req.query.today
      : istDateString;
    const todayDate = new Date(`${todayStr}T00:00:00Z`);
    const cutoffMs = todayDate.getTime() - (days - 1) * 86400000;
    const cutoffDateStr = new Date(cutoffMs).toISOString().slice(0, 10);

    const ordersRes = await db.query(
      `SELECT order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category,
              sperson_id, agent_name, cluster_id, order_date, created_at, status, items_count, total
       FROM orders
       WHERE (customer_id = $1 OR shop_short_id = $2)
         AND order_date >= $3
       ORDER BY order_date DESC, serial_no DESC`,
      [shop.shopid, shopShortId, cutoffDateStr]
    );

    const orderRows = ordersRes.rows || [];
    const itemsByOrderId = new Map();

    if (orderRows.length > 0) {
      const orderIds = orderRows.map((r) => String(r.order_id));
      const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(', ');
      const itemsRes = await db.query(
        `SELECT id, order_id, item_id, item_name, qty, price, cust_price, act_price, item_json
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
        const custPrice = Number(itemRow.cust_price);
        const listPrice = Number(itemRow.price);
        const unitPrice = (custPrice > 0) ? custPrice : (listPrice > 0 ? listPrice : 0);
        const lineTotal = Number((qty * unitPrice).toFixed(2));
        const unit = parsedJson.unitType || parsedJson.unit || 'Kgs';

        itemsByOrderId.get(oid).push({
          id: itemRow.id,
          itemId: Number(itemRow.item_id),
          name: itemRow.item_name,
          qty,
          unit,
          unitPrice,
          lineTotal
        });
      }
    }

    const formattedOrders = orderRows.map((o) => {
      const oid = String(o.order_id);
      const items = itemsByOrderId.get(oid) || [];
      const computedTotal = items.reduce((sum, it) => sum + it.lineTotal, 0);
      const orderTotal = Number(o.total || computedTotal);

      return {
        orderId: o.order_id,
        serialNo: Number(o.serial_no || 0),
        orderNumber: String(o.serial_no || o.order_id),
        date: o.order_date,
        createdAt: o.created_at,
        status: o.status || 'In progress',
        agentName: o.agent_name,
        total: orderTotal,
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

// 6b. PUT /api/shops/:shopId/assign (Assign shop to Field Sales Agent - Admin & Sales Manager)
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
      `Assigned shop #${shop.shopid} (${shop.shopName}) to Agent #${agentId} (${targetAgent.name})`
    );

    res.json({
      status: 200,
      message: `Shop #${shop.shopid} successfully assigned to ${targetAgent.name}.`,
      shop: {
        ...shop,
        assignedAgentId: agentId,
        assignedAgentName: targetAgent.name
      }
    });
  } catch (err) {
    console.error('Error assigning shop agent:', err);
    res.status(500).json({ status: 500, message: 'Internal server error while assigning shop.' });
  }
};

app.put('/api/shops/:shopId/assign', requireAuth, handleAssignShopAgent);
app.post('/api/shops/:shopId/assign-agent', requireAuth, handleAssignShopAgent);
app.post('/api/admin/shops/:shopId/assign', requireAuth, handleAssignShopAgent);

// 6c. GET /api/shops (List shops with role-based scoping)
app.get('/api/shops', requireAuth, async (req, res) => {
  await refreshStateFromDb();
  const caller = getCaller(req);
  if (!caller) return res.status(401).json({ status: 401, message: 'Authentication required' });

  const callerRole = (caller.role || '').toLowerCase();
  let scopedShops = shops;

  if (callerRole === 'field sales agent') {
    scopedShops = shops.filter((s) => Number(s.assignedAgentId || s.assigned_agent_id) === Number(caller.id));
  } else if (callerRole === 'sales manager') {
    const teamAgentIds = getAssignedAgentIds(caller.id);
    scopedShops = shops.filter((s) => {
      const assignedId = Number(s.assignedAgentId || s.assigned_agent_id || 0);
      const createdId = Number(s.createdby || s.created_by || 0);
      return teamAgentIds.includes(assignedId) ||
             teamAgentIds.includes(createdId) ||
             Number(s.clusterid) === Number(caller.clusterid);
    });
  }

  const userMap = new Map(salesPersons.map((u) => [Number(u.id), u.name]));
  const formatted = scopedShops.map((s) => {
    const aid = Number(s.assignedAgentId || s.assigned_agent_id || s.createdby || 0);
    return {
      ...s,
      assignedAgentId: aid,
      assignedAgentName: userMap.get(aid) || (aid ? `Agent #${aid}` : 'Unassigned')
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

  const validRoles = ['Admin', 'Sales Manager', 'Field Sales Agent', 'Delivery Agent'];
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
    const idRes = await tx.query('SELECT COALESCE(MAX(id), 100) + 1 AS next_id FROM users');
    nextId = Math.max(Number(idRes.rows[0]?.next_id || 101), 101);
    await tx.query(
      `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
       VALUES ($1, $2, $3, $4, 1, $5, 0, $6, 1, $7)`,
      [nextId, trimmedName, assignedRole, rawPhone, passwordHash, Number(clusterid || 1), createdOn]
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
    const validRoles = ['Admin', 'Sales Manager', 'Field Sales Agent', 'Delivery Agent'];
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
    updatedMustChange = 1;
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

app.put('/api/admin/permissions', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const { role, pages, actions } = req.body || {};

  if (role === 'Admin') {
    return res.status(400).json({
      status: 400,
      message: 'Security Protection: Administrator permissions are immutable to prevent system lockout.'
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
      deliveryUpdatedAt: o.deliveryUpdatedAt || null
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

  const currentStatus = order.status || 'In progress';

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
        deliveryUpdatedAt: order.deliveryUpdatedAt || null
      }
    });
  }

  if (currentStatus === 'Price approval pending') {
    return res.status(400).json({
      status: 400,
      message: `Invalid status transition: Order '${orderId}' is currently 'Price approval pending' and cannot be dispatched or updated until approved.`
    });
  }

  if (!isAdmin && ['Delivered', 'Could not deliver'].includes(currentStatus)) {
    return res.status(400).json({
      status: 400,
      message: `Duplicate or invalid status update: Order '${orderId}' is already finalized as '${currentStatus}'`
    });
  }

  if (!isAdmin && ['Pending', 'In progress'].includes(currentStatus)) {
    if (status === 'Delivered') {
      return res.status(400).json({
        status: 400,
        message: `Invalid status transition: Order '${orderId}' must be marked as 'Picked up' before it can be marked as 'Delivered'`
      });
    }
  }

  if (status === 'Could not deliver') {
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({
        status: 400,
        message: "A short reason is required when marking an order as 'Could not deliver'"
      });
    }
  }

  const updatedAt = new Date().toISOString();
  const updatedReason = reason ? String(reason).trim() : (order.deliveryReason || null);
  const updatedNote = note ? String(note).trim() : (order.deliveryNote || null);

  await db.query(
    `UPDATE orders
     SET status = $1, delivery_reason = $2, delivery_note = $3, delivery_updated_at = $4, delivery_updated_by = $5
     WHERE order_id = $6`,
    [status, updatedReason, updatedNote, updatedAt, Number(caller.id), order.orderId || order.id]
  );

  await refreshStateFromDb();
  await addAuditLog(
    req,
    'UPDATE_DELIVERY_STATUS',
    'Order',
    order.id,
    `Updated order ${order.id} delivery status from '${currentStatus}' to '${status}'${updatedReason ? ` (Reason: ${updatedReason})` : ''}${deviceEventTime ? ` [deviceEventTime: ${deviceEventTime}]` : ''}${idempotencyKey ? ` [idempotencyKey: ${idempotencyKey}]` : ''}`
  );

  res.json({
    status: 200,
    message: `Delivery status updated to '${status}'`,
    order: {
      id: order.id,
      status,
      deliveryReason: updatedReason,
      deliveryUpdatedAt: updatedAt
    }
  });
});

// 5. Admin Organization-Wide Executive Reports
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  await refreshStateFromDb();
  const { clusterId, managerId, agentId, fromDate, toDate } = req.query;

  let allowedAgentIds = null;
  if (managerId && managerId !== 'all') {
    allowedAgentIds = getAssignedAgentIds(managerId);
  }
  if (agentId && agentId !== 'all') {
    allowedAgentIds = [Number(agentId)];
  }

  const orders = submittedOrders.filter((o) => {
    if (allowedAgentIds && !allowedAgentIds.includes(Number(o.spersonid))) return false;
    if (fromDate && o.date < fromDate) return false;
    if (toDate && o.date > toDate) return false;
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
  const achievementRate = targetAmount > 0 ? Math.min(100, Math.round((achievedAmount / targetAmount) * 100)) : 0;

  res.json({
    status: 200,
    report: {
      hasTarget: targetAmount > 0,
      targetAmount,
      achievedAmount,
      targetGap,
      achievementRate,
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

    let list = [...priceRequestsList];

    if (isManager) {
      const assignedAgentIds = getAssignedAgentIds(caller.id);
      list = list.filter((pr) => assignedAgentIds.includes(Number(pr.agentId)) || Number(pr.clusterId) === Number(caller.clusterid));
    } else if (isAgent) {
      list = list.filter((pr) => Number(pr.agentId) === Number(caller.id));
    }

    const statusFilter = req.query.status;
    if (statusFilter && statusFilter !== 'all') {
      list = list.filter((pr) => pr.status === statusFilter);
    }

    const enriched = list.map((pr) => {
      const sh = shops.find((s) => Number(s.shopid) === Number(pr.shopId));
      const it = orderItemsCatalog.find((i) => Number(i.itemId || i.itemid) === Number(pr.itemId));
      const ag = salesPersons.find((u) => Number(u.id) === Number(pr.agentId));
      const cl = clusters.find((c) => Number(c.clusterId || c.clusterid) === Number(pr.clusterId));
      return {
        ...pr,
        shopName: sh?.shopName || `Shop #${pr.shopId}`,
        itemName: it?.itemName || `Item #${pr.itemId}`,
        agentName: ag?.name || `Agent #${pr.agentId}`,
        clusterName: cl?.clusterName || `Cluster #${pr.clusterId}`
      };
    });

    res.json({
      status: 200,
      priceRequests: enriched,
      pendingCount: enriched.filter((pr) => pr.status === 'pending').length
    });
  } catch (err) {
    console.error('[Get Price Requests Error]', err);
    res.status(500).json({ status: 500, message: `Failed to load price requests: ${err.message}` });
  }
});

// 2. POST /api/price-requests/:id/decision (Admin & Sales Manager decision workflow)
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

    // Enforce manager assignment scope
    if (isManager) {
      const assignedAgentIds = getAssignedAgentIds(caller.id);
      const isAssignedAgent = assignedAgentIds.includes(Number(pr.agentId));
      const isAssignedCluster = Number(pr.clusterId) === Number(caller.clusterid);
      if (!isAssignedAgent && !isAssignedCluster) {
        return res.status(403).json({
          status: 403,
          message: `Access Denied: Price request #${requestId} is outside your assigned team and cluster scope.`
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
    const nowIso = new Date().toISOString();
    const decComment = comment ? String(comment).trim() : '';

    await db.withTransaction(async (tx) => {
      // 1. Update price_requests table
      await tx.query(
        `UPDATE price_requests
         SET status = $1, decision_by = $2, decision_by_name = $3, decision_at = $4, decision_comment = $5, apply_to_catalog = $6
         WHERE id = $7`,
        [finalStatus, Number(caller.id), caller.name || `User ${caller.id}`, nowIso, decComment, applyToCatalog ? 1 : 0, requestId]
      );

      // 2. Update order_items table for this order and item
      if (isApprove) {
        await tx.query(
          `UPDATE order_items
           SET price = $1, cust_price = $1, act_price = $1, price_request_status = 'approved'
           WHERE order_id = $2 AND item_id = $3`,
          [pr.requestedPrice, pr.orderId, pr.itemId]
        );
      } else {
        await tx.query(
          `UPDATE order_items
           SET price_request_status = 'rejected'
           WHERE order_id = $1 AND item_id = $2`,
          [pr.orderId, pr.itemId]
        );
      }

      // 3. Recalculate total of order_items for this order
      const orderItemsRows = await tx.query(
        'SELECT qty, price FROM order_items WHERE order_id = $1',
        [pr.orderId]
      );
      const recalculatedTotal = orderItemsRows.rows.reduce(
        (sum, row) => sum + (Number(row.qty) || 0) * (Number(row.price) || 0),
        0
      );

      // 4. Check if there are any remaining pending price requests for this order
      const pendingCheck = await tx.query(
        "SELECT COUNT(*) AS cnt FROM price_requests WHERE order_id = $1 AND status = 'pending' AND id != $2",
        [pr.orderId, requestId]
      );
      const remainingPending = Number(pendingCheck.rows[0]?.cnt || 0);

      // If no more pending requests for this order, transition order status to 'In progress'
      if (remainingPending === 0) {
        await tx.query(
          `UPDATE orders
           SET total = $1, status = 'In progress'
           WHERE order_id = $2 AND status = 'Price approval pending'`,
          [recalculatedTotal, pr.orderId]
        );
      } else {
        await tx.query(
          'UPDATE orders SET total = $1 WHERE order_id = $2',
          [recalculatedTotal, pr.orderId]
        );
      }

      // 5. If applyToCatalog requested and authorized, update cluster item price or catalog price
      if (applyToCatalog && isApprove) {
        if (isAdmin || (isManager && Number(pr.clusterId) === Number(caller.clusterid))) {
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
      `${isApprove ? 'Approved' : 'Rejected'} price request ${requestId} for order ${pr.orderId} (Item: ${pr.itemId}, Req: ₹${pr.requestedPrice}, Cat: ₹${pr.catalogPrice}) by ${caller.name}${decComment ? ` [Note: ${decComment}]` : ''}`
    );

    res.json({
      status: 200,
      message: `Price request ${finalStatus} successfully.`,
      requestId,
      decision: finalStatus,
      decidedBy: caller.name,
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
    orders = submittedOrders.filter((o) => Number(o.assignedDeliveryAgentId) === Number(caller.id));
  } else {
    // Field Sales Agent: strictly scoped to caller.id
    orders = submittedOrders.filter((o) => Number(o.spersonid) === Number(caller.id));
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

  const formatted = filtered.map((o) => ({
    id: o.orderId || o.id,
    orderId: o.orderId || o.id,
    customer: o.shopName || o.customer || 'Shop',
    shopName: o.shopName || o.customer || 'Shop',
    shopid: o.shopid || o.customerId || o.shopId,
    customerId: o.shopid || o.customerId || o.shopId,
    date: o.date || o.orderDate,
    itemsCount: (o.orderList || []).length || o.itemsCount || 0,
    total: Number(o.total || 0),
    status: o.status || 'In progress',
    clusterId: o.clusterId,
    spersonid: o.spersonid,
    deliveryAgentId: o.deliveryAgentId,
    orderList: o.orderList || []
  }));

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

    const agent = salesPersons.find((u) => Number(u.id) === Number(spersonId)) || caller;
    const finalClusterId = Number(clusterId || shop.clusterid || 1);
    const dateStr = orderDate && /^\d{4}-\d{2}-\d{2}$/.test(orderDate) ? orderDate : new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    let newOrderId = '';
    let newSerial = 0;
    let orderTotal = 0;

    await db.withTransaction(async (tx) => {
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
        `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name, cluster_id, order_date, created_at, status, items_count, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'In progress', $12, $13)`,
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
    const beforeStatus = order.status;
    const beforeTotal = order.total;
    const beforeLinesCount = (order.orderList || []).length;

    let newStatus = status ? String(status).trim() : order.status;
    let newDeliveryAgentId = deliveryAgentId !== undefined
      ? (deliveryAgentId === null || deliveryAgentId === '' ? null : Number(deliveryAgentId))
      : order.deliveryAgentId;

    let newTotal = order.total;
    let newLinesCount = (order.orderList || []).length;
    const hasNewLines = Array.isArray(orderList) && orderList.length > 0;

    await db.withTransaction(async (tx) => {
      if (hasNewLines) {
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

      await tx.query(
        `UPDATE orders
         SET status = $1, delivery_agent_id = $2, total = $3, items_count = $4
         WHERE order_id = $5`,
        [newStatus, newDeliveryAgentId, newTotal, newLinesCount, order.orderId]
      );
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
    const beforeStatus = order.status;

    await db.query(
      `UPDATE orders SET status = 'Cancelled' WHERE order_id = $1`,
      [order.orderId]
    );

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
  if (!checkActionPermission(callerRole, 'view_team_reports')) {
    return res.status(403).json({
      status: 403,
      message: 'Permission Denied: Viewing reports has been disabled for your role by an Administrator.'
    });
  }

  const managerId = auth.effectiveManagerId;
  const assignedAgentIds = getAssignedAgentIds(managerId);

  const reqAgentId = req.query.agentId;
  const clusterId = req.query.clusterId;
  const fromDate = req.query.fromDate;
  const toDate = req.query.toDate;

  if (assignedAgentIds.length === 0) {
    return res.json({
      status: 200,
      report: {
        hasTarget: false,
        targetAmount: 0,
        achievedAmount: 0,
        targetGap: 0,
        achievementRate: 0,
        itemBreakdown: [],
        dailyComparison: [],
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
    : assignedAgentIds;

  const orders = submittedOrders.filter((o) => {
    if (!targetAgentIds.includes(Number(o.spersonid))) return false;
    if (fromDate && o.date < fromDate) return false;
    if (toDate && o.date > toDate) return false;
    if (clusterId && clusterId !== 'all' && Number(o.clusterId) !== Number(clusterId)) return false;
    return true;
  });

  const achievedAmount = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const itemAchievedMap = {};
  defaultOrderItems.forEach((item) => {
    itemAchievedMap[item.itemid] = {
      itemId: item.itemid,
      itemName: item.itemName,
      price: item.price,
      achievedQty: 0,
      achievedValue: 0
    };
  });

  orders.forEach((o) => {
    (o.orderList || []).forEach((item) => {
      const id = item.itemid;
      const qty = parseFloat(item.qty) || 0;
      const price = parseFloat(item.custprice || item.price || item.actprice || 50);
      if (!itemAchievedMap[id]) {
        itemAchievedMap[id] = {
          itemId: id,
          itemName: item.itemName || `Item ${id}`,
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
        const id = it.itemId;
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
    const targetQty = tgt.targetQty;
    const targetVal = tgt.targetAmount;
    const qtyGap = Math.max(0, targetQty - ach.achievedQty);
    const valueGap = Math.max(0, targetVal - ach.achievedValue);

    return {
      itemId: ach.itemId,
      itemName: ach.itemName,
      price: ach.price,
      targetQty,
      achievedQty: ach.achievedQty,
      qtyGap,
      targetValue: targetVal,
      achievedValue: ach.achievedValue,
      valueGap,
      hasTarget: targetQty > 0 || targetVal > 0
    };
  });

  const targetGap = hasTarget ? Math.max(0, targetAmount - achievedAmount) : 0;
  const achievementRate = hasTarget && targetAmount > 0
    ? Math.min(100, Math.round((achievedAmount / targetAmount) * 100))
    : 0;

  const todayISO = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000);
  const yestISO = yest.toISOString().slice(0, 10);

  const todayAchieved = orders
    .filter((o) => o.date === todayISO)
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const yestAchieved = orders
    .filter((o) => o.date === yestISO)
    .reduce((sum, o) => sum + Number(o.total || 0), 0);

  const dailyComparison = [
    { label: 'Yesterday', date: yestISO, achieved: yestAchieved, target: hasTarget ? Math.round(targetAmount / 2) : 0 },
    { label: 'Today', date: todayISO, achieved: todayAchieved, target: hasTarget ? Math.round(targetAmount / 2) : 0 }
  ];

  res.json({
    status: 200,
    report: {
      hasTarget,
      targetAmount,
      achievedAmount,
      targetGap,
      achievementRate,
      itemBreakdown,
      dailyComparison,
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
      creatorAgent: creatorAgent ? { id: creatorAgent.id, name: creatorAgent.name } : null
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

// SPA fallback for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ status: 404, message: 'API route not found.' });
  }
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Global error handler (handles multer file size limit & JSON parse errors cleanly)
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      status: 400,
      message: 'Uploaded image exceeds maximum allowed size of 5 MB.'
    });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      status: 400,
      message: 'Invalid JSON request payload.'
    });
  }
  console.error('[Server Error]', err?.message || err);
  res.status(500).json({
    status: 500,
    message: 'Internal server error.'
  });
});

// Initialize Database, Run Repeatable Migrations, and Start HTTP Server
async function startServer() {
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
