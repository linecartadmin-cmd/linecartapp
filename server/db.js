import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

export const KNOWN_DEMO_PASSWORDS = new Set([
  'admin123',
  'password123',
  '1234',
  'demo123',
  '123456',
  '12345678',
  'password',
  'qwerty123',
  'linecart123'
]);

export function isValidIndianMobile(phone) {
  return typeof phone === 'string' && INDIAN_MOBILE_REGEX.test(phone);
}

export function isKnownDemoPassword(password) {
  if (typeof password !== 'string') return false;
  return KNOWN_DEMO_PASSWORDS.has(password.trim().toLowerCase());
}

/**
 * Convert PostgreSQL $1, $2... positional parameters into ? placeholders for embedded SQL engine
 */
function convertPgParamsToSqlite(sql, params = []) {
  if (!params || params.length === 0) {
    return { sql, params: [] };
  }
  const expandedParams = [];
  const convertedSql = sql.replace(/\$(\d+)/g, (_, numStr) => {
    const idx = parseInt(numStr, 10) - 1;
    let val = params[idx];
    if (val === undefined) val = null;
    if (typeof val === 'boolean') val = val ? 1 : 0;
    expandedParams.push(val);
    return '?';
  });
  return { sql: convertedSql, params: expandedParams };
}

class DatabaseAdapter {
  constructor() {
    this.mode = 'uninitialized';
    this.pool = null;
    this.sqlite = null;
    this.dbPath = null;
    this.inTx = false;
  }

  async init() {
    const dbUrl = (process.env.DATABASE_URL || '').trim();
    const isCloudOrStaging = (process.env.NODE_ENV || '').toLowerCase() === 'production' ||
                             (process.env.APP_ENV || '').toLowerCase() === 'staging' ||
                             Boolean(process.env.RENDER);

    if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
      this.mode = 'postgres';
      const useSsl = process.env.DB_SSL === 'true' || dbUrl.includes('sslmode=require') || dbUrl.includes('supabase.com');
      
      let sslOptions = undefined;
      if (useSsl) {
        sslOptions = { rejectUnauthorized: true };
        // Check for Root CA certificate: from environment variable or mounted secret file
        const caContent = (process.env.DB_CA_CERT || process.env.SUPABASE_CA_CERT || '').trim();
        const candidateCaPaths = [
          process.env.DB_CA_CERT_PATH,
          '/etc/secrets/prod-ca-2021.crt', // Render secret file default mount path
          path.resolve(__dirname, 'prod-ca-2021.crt'),
          path.resolve(__dirname, '../prod-ca-2021.crt'),
          path.resolve(process.cwd(), 'prod-ca-2021.crt'),
          'C:\\Users\\samma\\Desktop\\rea\\prod-ca-2021.crt'
        ].filter(Boolean);

        const foundCaPath = candidateCaPaths.find((p) => fs.existsSync(p));

        if (caContent && caContent.includes('-----BEGIN CERTIFICATE-----')) {
          sslOptions.ca = caContent;
          console.log('[DB] Enforcing strict TLS certificate verification using DB_CA_CERT environment variable');
        } else if (foundCaPath) {
          sslOptions.ca = fs.readFileSync(foundCaPath, 'utf8');
          console.log(`[DB] Enforcing strict TLS certificate verification using CA file at ${foundCaPath}`);
        } else if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false') {
          sslOptions.rejectUnauthorized = false;
          console.warn('[DB WARNING] Strict CA verification is disabled via DB_SSL_REJECT_UNAUTHORIZED=false.');
        } else {
          console.log('[DB] Connecting with system default TLS certificate verification (rejectUnauthorized: true)');
        }
      }

      const isSupabase = dbUrl.includes('supabase.com');
      const defaultPoolMax = isSupabase ? 3 : 10;
      const parsedPoolMax = parseInt(process.env.DB_POOL_MAX, 10);
      const poolMax = !isNaN(parsedPoolMax) && parsedPoolMax > 0 ? parsedPoolMax : defaultPoolMax;

      const idleTimeoutMillis = Number(process.env.DB_POOL_IDLE_TIMEOUT_MS || 5000);
      const connectionTimeoutMillis = Number(process.env.DB_POOL_CONN_TIMEOUT_MS || 10000);

      this.pool = new Pool({
        connectionString: dbUrl,
        max: poolMax,
        idleTimeoutMillis,
        connectionTimeoutMillis,
        ssl: sslOptions
      });

      this.pool.on('error', (err) => {
        console.error('[DB Pool Error]', err?.message || err);
      });

      // Verify connection with graceful retry for pooler session availability
      const maxRetries = 6;
      const retryDelayMs = 2500;
      let lastErr = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const client = await this.pool.connect();
          client.release();
          console.log(`[DB] Connected to external PostgreSQL database (${isSupabase ? 'Supabase' : 'Remote Postgres'}) via DATABASE_URL (pool max: ${poolMax}, idleTimeout: ${idleTimeoutMillis}ms)`);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const isSessionExhausted = err.message && (
            err.message.includes('EMAXCONNSESSION') ||
            err.message.includes('max clients reached') ||
            err.message.includes('pool_size')
          );
          if (isSessionExhausted && attempt < maxRetries) {
            console.warn(`[DB] Supabase pooler session capacity reached (attempt ${attempt}/${maxRetries}). Waiting ${retryDelayMs / 1000}s for existing sessions to drain...`);
            await new Promise((res) => setTimeout(res, retryDelayMs));
          } else {
            throw err;
          }
        }
      }
      if (lastErr) throw lastErr;
    } else {
      if (isCloudOrStaging) {
        throw new Error(
          '[DB FATAL] DATABASE_URL is required in cloud/staging/production mode. Silently falling back to local SQLite on cloud hosting is prohibited.'
        );
      }
      this.mode = 'embedded-postgres-compat';
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.dbPath = process.env.LOCAL_DB_PATH
        ? path.resolve(process.env.LOCAL_DB_PATH)
        : path.join(dataDir, 'linecart.pg.db');
      this.sqlite = new DatabaseSync(this.dbPath);
      this.sqlite.exec('PRAGMA journal_mode = WAL;');
      this.sqlite.exec('PRAGMA synchronous = FULL;');
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
      this.sqlite.exec('PRAGMA busy_timeout = 5000;');
      console.log(`[DB] Initialized durable on-disk SQL database at ${this.dbPath}`);
    }
  }

  async execRaw(sqlScript) {
    if (this.mode === 'postgres') {
      await this.pool.query(sqlScript);
    } else {
      this.sqlite.exec(sqlScript);
    }
  }

  async query(sql, params = []) {
    if (this.mode === 'postgres') {
      const res = await this.pool.query(sql, params);
      return { rows: res.rows || [], rowCount: res.rowCount || 0 };
    } else {
      const { sql: sqliteSql, params: sqliteParams } = convertPgParamsToSqlite(sql, params);
      const trimmed = sqliteSql.trim();
      const isSelect = /^(SELECT|WITH|PRAGMA)/i.test(trimmed) || /RETURNING\s+/i.test(trimmed);
      const stmt = this.sqlite.prepare(sqliteSql);
      if (isSelect) {
        const rows = stmt.all(...sqliteParams);
        return { rows, rowCount: rows.length };
      } else {
        const info = stmt.run(...sqliteParams);
        return { rows: [], rowCount: Number(info.changes || 0) };
      }
    }
  }

  async withClient(fn) {
    if (this.mode === 'postgres') {
      const client = await this.pool.connect();
      try {
        const clientQuery = async (sql, params = []) => {
          const res = await client.query(sql, params);
          return { rows: res.rows || [], rowCount: res.rowCount || 0 };
        };
        return await fn({ query: clientQuery });
      } finally {
        client.release();
      }
    } else {
      return await fn({ query: (sql, params) => this.query(sql, params) });
    }
  }

  async withTransaction(fn) {
    if (this.mode === 'postgres') {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const txQuery = async (sql, params = []) => {
          const res = await client.query(sql, params);
          return { rows: res.rows || [], rowCount: res.rowCount || 0 };
        };
        const result = await fn({ query: txQuery });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      const isOuter = !this.inTx;
      if (isOuter) {
        this.sqlite.exec('BEGIN IMMEDIATE');
        this.inTx = true;
      }
      try {
        const result = await fn({ query: (sql, params) => this.query(sql, params) });
        if (isOuter) {
          this.sqlite.exec('COMMIT');
          this.inTx = false;
        }
        return result;
      } catch (err) {
        if (isOuter && this.inTx) {
          try {
            this.sqlite.exec('ROLLBACK');
          } catch {}
          this.inTx = false;
        }
        throw err;
      }
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
    }
  }
}

export const db = new DatabaseAdapter();

/**
 * Run SQL schema migrations and seed/migrate initial records idempotently.
 */
export async function runMigrationsAndSeed({
  seedData,
  legacyAdminConfigPath,
  hashPassword,
  verifyPassword,
  isProduction,
  defaultRolePermissions
} = {}) {
  const migrationFile = path.join(__dirname, 'migrations', '001_initial_schema.sql');
  const migrationSql = fs.readFileSync(migrationFile, 'utf8');
  await db.execRaw(migrationSql);

  const migCheck = await db.query(
    'SELECT version FROM schema_migrations WHERE version = $1',
    ['001_initial_schema']
  );
  if (migCheck.rowCount === 0) {
    await db.query(
      'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
      ['001_initial_schema', new Date().toISOString()]
    );
    console.log('[DB Migration] Applied 001_initial_schema.sql');
  }

  // Ensure items table columns and 002_items_daily_pricing migration
  if (db.mode === 'postgres') {
    await db.execRaw(`
      ALTER TABLE items ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_at TEXT;
      ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_by INTEGER;
      ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_by_name TEXT;
      ALTER TABLE items ADD COLUMN IF NOT EXISTS created_at TEXT;
    `);
  } else {
    try {
      const tableInfo = await db.query("PRAGMA table_info('items')");
      const existingCols = new Set(tableInfo.rows.map((r) => r.name));
      if (!existingCols.has('active')) {
        await db.execRaw('ALTER TABLE items ADD COLUMN active INTEGER NOT NULL DEFAULT 1;');
      }
      if (!existingCols.has('updated_at')) {
        await db.execRaw('ALTER TABLE items ADD COLUMN updated_at TEXT;');
      }
      if (!existingCols.has('updated_by')) {
        await db.execRaw('ALTER TABLE items ADD COLUMN updated_by INTEGER;');
      }
      if (!existingCols.has('updated_by_name')) {
        await db.execRaw('ALTER TABLE items ADD COLUMN updated_by_name TEXT;');
      }
      if (!existingCols.has('created_at')) {
        await db.execRaw('ALTER TABLE items ADD COLUMN created_at TEXT;');
      }
    } catch (colErr) {
      console.warn('[DB Migration] Could not verify/add items columns in SQLite:', colErr.message);
    }
  }

  const mig2File = path.join(__dirname, 'migrations', '002_items_daily_pricing.sql');
  if (fs.existsSync(mig2File)) {
    const mig2Sql = fs.readFileSync(mig2File, 'utf8');
    await db.execRaw(mig2Sql);
    const mig2Check = await db.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      ['002_items_daily_pricing']
    );
    if (mig2Check.rowCount === 0) {
      await db.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
        ['002_items_daily_pricing', new Date().toISOString()]
      );
      console.log('[DB Migration] Applied 002_items_daily_pricing.sql');
    }
  }

  // Ensure order_items columns for customer price requests
  if (db.mode === 'postgres') {
    await db.execRaw(`
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS requested_price REAL;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_request_status TEXT;
    `);
  } else {
    try {
      const oiTableInfo = await db.query("PRAGMA table_info('order_items')");
      const oiCols = new Set(oiTableInfo.rows.map((r) => r.name));
      if (!oiCols.has('requested_price')) {
        await db.execRaw('ALTER TABLE order_items ADD COLUMN requested_price REAL;');
      }
      if (!oiCols.has('price_request_status')) {
        await db.execRaw('ALTER TABLE order_items ADD COLUMN price_request_status TEXT;');
      }
    } catch (oiErr) {
      console.warn('[DB Migration] Could not verify/add order_items columns in SQLite:', oiErr.message);
    }
  }

  const mig3File = path.join(__dirname, 'migrations', '003_price_requests.sql');
  if (fs.existsSync(mig3File)) {
    const mig3Sql = fs.readFileSync(mig3File, 'utf8');
    await db.execRaw(mig3Sql);
    const mig3Check = await db.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      ['003_price_requests']
    );
    if (mig3Check.rowCount === 0) {
      await db.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
        ['003_price_requests', new Date().toISOString()]
      );
      console.log('[DB Migration] Applied 003_price_requests.sql');
    }
  }

  // Ensure shops table has assigned_agent_id column and migration 004
  if (db.mode === 'postgres') {
    await db.execRaw(`
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS assigned_agent_id INTEGER;
      CREATE INDEX IF NOT EXISTS idx_shops_assigned_agent ON shops(assigned_agent_id);
      CREATE SEQUENCE IF NOT EXISTS login_attempts_id_seq;
      ALTER TABLE login_attempts ALTER COLUMN id SET DEFAULT nextval('login_attempts_id_seq');
    `);
  } else {
    try {
      const shopTableInfo = await db.query("PRAGMA table_info('shops')");
      const shopCols = new Set(shopTableInfo.rows.map((r) => r.name));
      if (!shopCols.has('assigned_agent_id')) {
        await db.execRaw('ALTER TABLE shops ADD COLUMN assigned_agent_id INTEGER;');
      }
      await db.execRaw('CREATE INDEX IF NOT EXISTS idx_shops_assigned_agent ON shops(assigned_agent_id);');
    } catch (shopErr) {
      console.warn('[DB Migration] Could not verify/add assigned_agent_id column in SQLite:', shopErr.message);
    }
  }

  const mig4File = path.join(__dirname, 'migrations', '004_shop_agent_assignments.sql');
  if (fs.existsSync(mig4File)) {
    const mig4Check = await db.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      ['004_shop_agent_assignments']
    );
    if (mig4Check.rowCount === 0) {
      await db.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
        ['004_shop_agent_assignments', new Date().toISOString()]
      );
      console.log('[DB Migration] Applied 004_shop_agent_assignments.sql');
    }
  }

  // Ensure orders table has payment collection columns and migration 005
  if (db.mode === 'postgres') {
    await db.execRaw(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'Not collected';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_amount_collected REAL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_balance_due REAL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_collected_at TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_collected_by INTEGER;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_collected_by_name TEXT;
      CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
    `);
  } else {
    try {
      const orderTableInfo = await db.query("PRAGMA table_info('orders')");
      const orderCols = new Set(orderTableInfo.rows.map((r) => r.name));
      if (!orderCols.has('payment_status')) {
        await db.execRaw("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'Not collected';");
      }
      if (!orderCols.has('payment_amount_collected')) {
        await db.execRaw('ALTER TABLE orders ADD COLUMN payment_amount_collected REAL DEFAULT 0;');
      }
      if (!orderCols.has('payment_balance_due')) {
        await db.execRaw('ALTER TABLE orders ADD COLUMN payment_balance_due REAL DEFAULT 0;');
      }
      if (!orderCols.has('payment_collected_at')) {
        await db.execRaw('ALTER TABLE orders ADD COLUMN payment_collected_at TEXT;');
      }
      if (!orderCols.has('payment_collected_by')) {
        await db.execRaw('ALTER TABLE orders ADD COLUMN payment_collected_by INTEGER;');
      }
      if (!orderCols.has('payment_collected_by_name')) {
        await db.execRaw('ALTER TABLE orders ADD COLUMN payment_collected_by_name TEXT;');
      }
      await db.execRaw('CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);');
    } catch (orderErr) {
      console.warn('[DB Migration] Could not verify/add payment columns in SQLite:', orderErr.message);
    }
  }

  const mig5File = path.join(__dirname, 'migrations', '005_payment_collection.sql');
  if (fs.existsSync(mig5File)) {
    const mig5Check = await db.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      ['005_payment_collection']
    );
    if (mig5Check.rowCount === 0) {
      await db.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
        ['005_payment_collection', new Date().toISOString()]
      );
      console.log('[DB Migration] Applied 005_payment_collection.sql');
    }
  }

  // Safely backfill balance_due for existing orders without inventing past collections
  try {
    await db.query(`
      UPDATE orders
      SET payment_balance_due = total - COALESCE(payment_amount_collected, 0)
      WHERE payment_balance_due IS NULL OR (payment_balance_due = 0 AND payment_amount_collected = 0 AND total > 0)
    `);
  } catch (balErr) {
    console.warn('[DB Migration] Could not backfill payment_balance_due:', balErr.message);
  }

  // Preserve existing data: safely backfill assigned_agent_id from created_by for any unassigned shops
  try {
    await db.query('UPDATE shops SET assigned_agent_id = created_by WHERE assigned_agent_id IS NULL AND created_by IS NOT NULL');
  } catch (initErr) {
    console.warn('[DB Migration] Could not initialize assigned_agent_id default:', initErr.message);
  }

  // Load legacy admin_config.json if present for one-time repeatable migration
  let legacyConfig = {};
  if (legacyAdminConfigPath && fs.existsSync(legacyAdminConfigPath)) {
    try {
      legacyConfig = JSON.parse(fs.readFileSync(legacyAdminConfigPath, 'utf8'));
    } catch (err) {
      console.warn('[DB Migration] Could not parse legacy admin_config.json:', err.message);
    }
  }

  const isCloudOrPostgres = db.mode === 'postgres' ||
                           Boolean(isProduction) ||
                           (process.env.APP_ENV || '').toLowerCase() === 'staging' ||
                           Boolean(process.env.RENDER);

  const invalidPhoneAccounts = [];

  await db.withTransaction(async (tx) => {
    // 1. Survey Items
    for (const si of seedData.defaultSurveyItems || []) {
      await tx.query(
        `INSERT INTO survey_items (item_id, item_name)
         VALUES ($1, $2)
         ON CONFLICT (item_id) DO NOTHING`,
        [Number(si.itemid), String(si.itemName || '')]
      );
    }

    // 2. Order Items Catalog
    for (const item of seedData.defaultOrderItems || []) {
      await tx.query(
        `INSERT INTO items (item_id, item_name, item_image, qty, price, cprice, kgs_per_unit, remarks, unit_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (item_id) DO NOTHING`,
        [
          Number(item.itemid),
          String(item.itemName || ''),
          String(item.itemimage || ''),
          Number(item.qty || 0),
          Number(item.price || 0),
          Number(item.cprice || 0),
          Number(item.kgsperunit || 50),
          Number(item.remarks || 0),
          String(item.unitType || 'Kgs')
        ]
      );
    }

    // 3. Clusters
    for (const c of seedData.clusters || []) {
      await tx.query(
        `INSERT INTO clusters (cluster_id, cluster_name, survey_items_json)
         VALUES ($1, $2, $3)
         ON CONFLICT (cluster_id) DO NOTHING`,
        [
          Number(c.clusterId),
          String(c.clusterName || ''),
          JSON.stringify(c.surveyItemsList || seedData.defaultSurveyItems || [])
        ]
      );
    }

    // Helper to check if a stored hash matches any known demo password
    const isHashFromKnownDemoPassword = (hashStr) => {
      if (!hashStr || typeof verifyPassword !== 'function') return false;
      for (const demoPwd of KNOWN_DEMO_PASSWORDS) {
        if (verifyPassword(demoPwd, hashStr, false)) {
          return true;
        }
      }
      return false;
    };

    // 4. Users (seed only when users table is empty AND running in local SQLite dev mode)
    const existingUsersCountRes = await tx.query('SELECT COUNT(*) AS cnt FROM users');
    const isInitialUserSeed = Number(existingUsersCountRes.rows[0]?.cnt || 0) === 0;
    const shouldSeedUsers = isInitialUserSeed && !isCloudOrPostgres;

    if (shouldSeedUsers) {
      const mergedUsersMap = new Map();
      for (const sp of seedData.salesPersons || []) {
        mergedUsersMap.set(Number(sp.id), { ...sp });
      }
      if (Array.isArray(legacyConfig.customUsers)) {
        for (const cu of legacyConfig.customUsers) {
          const existing = mergedUsersMap.get(Number(cu.id)) || {};
          mergedUsersMap.set(Number(cu.id), { ...existing, ...cu });
        }
      }
      if (legacyConfig.userOverrides && typeof legacyConfig.userOverrides === 'object') {
        for (const [idStr, ovr] of Object.entries(legacyConfig.userOverrides)) {
          const uid = Number(idStr);
          if (mergedUsersMap.has(uid)) {
            mergedUsersMap.set(uid, { ...mergedUsersMap.get(uid), ...ovr });
          }
        }
      }

      if (!mergedUsersMap.has(50)) {
        mergedUsersMap.set(50, {
          id: 50,
          name: 'Murugan K',
          role: 'Delivery Agent',
          phone: '9876500050',
          password: '1234',
          clusterid: 1,
          active: 1,
          createdon: '2026-10-25 09:00:00'
        });
      }

      const usedPhones = new Map();

      for (const [uid, u] of mergedUsersMap.entries()) {
        const rawPhone = u.phone !== undefined && u.phone !== null ? String(u.phone).trim() : '';
        let phoneValid = isValidIndianMobile(rawPhone) ? 1 : 0;
        let phoneToStore = rawPhone || null;

        if (phoneValid) {
          const existingOwner = usedPhones.get(rawPhone);
          if (existingOwner !== undefined && existingOwner !== uid) {
            phoneValid = 0;
            phoneToStore = null;
          } else {
            usedPhones.set(rawPhone, uid);
          }
        } else {
          phoneToStore = null;
        }

        if (!phoneValid) {
          invalidPhoneAccounts.push({
            id: uid,
            name: u.name || `User #${uid}`,
            role: u.role || 'Field Sales Agent',
            rawPhone: rawPhone ? `${rawPhone.slice(0, 2)}***` : '(missing)',
            reason: !rawPhone ? 'Missing mobile number' : !isValidIndianMobile(rawPhone) ? 'Does not match 10-digit Indian mobile format (6-9xxxxxxxxx)' : 'Duplicate mobile number'
          });
        }

        let pwdHash = u.passwordHash || null;
        let mustChange = u.mustChangePassword ? 1 : 0;

        if (isProduction && pwdHash && isHashFromKnownDemoPassword(pwdHash)) {
          pwdHash = null;
          mustChange = 1;
        }

        if (!pwdHash && u.password) {
          if (isProduction && isKnownDemoPassword(String(u.password))) {
            pwdHash = null;
            mustChange = 1;
          } else {
            pwdHash = hashPassword(String(u.password));
          }
        }

        await tx.query(
          `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            uid,
            String(u.name || `User #${uid}`),
            String(u.role || 'Field Sales Agent'),
            phoneToStore,
            phoneValid,
            pwdHash,
            mustChange,
            Number(u.clusterid || 1),
            u.active !== undefined ? Number(u.active) : 1,
            String(u.createdon || '2026-04-01 09:00:00')
          ]
        );
      }
    }

    // In production mode, scrub any user in DB whose password_hash matches a known demo password
    if (isProduction && typeof verifyPassword === 'function') {
      const allDbUsers = await tx.query('SELECT id, password_hash FROM users WHERE password_hash IS NOT NULL');
      for (const row of allDbUsers.rows) {
        if (isHashFromKnownDemoPassword(row.password_hash)) {
          await tx.query(
            'UPDATE users SET password_hash = NULL, must_change_password = 1 WHERE id = $1',
            [Number(row.id)]
          );
        }
      }
    }

    // Optional First-Admin bootstrap via INITIAL_ADMIN_PHONE & INITIAL_ADMIN_PASSWORD env vars
    // Runs on initial seed OR when no active Admin has a valid password_hash
    const activeAdminsWithHash = await tx.query(
      "SELECT COUNT(*) AS cnt FROM users WHERE role = 'Admin' AND active = 1 AND phone_valid = 1 AND password_hash IS NOT NULL"
    );
    const hasConfiguredAdmin = Number(activeAdminsWithHash.rows[0]?.cnt || 0) > 0;

    const initAdminPhone = (process.env.INITIAL_ADMIN_PHONE || '').trim();
    const initAdminPassword = process.env.INITIAL_ADMIN_PASSWORD || '';
    const initAdminName = (process.env.INITIAL_ADMIN_NAME || 'LineCart Administrator').trim();
    if ((isInitialUserSeed || !hasConfiguredAdmin) && initAdminPhone && initAdminPassword) {
      if (isValidIndianMobile(initAdminPhone) && initAdminPassword.length >= 8 && !isKnownDemoPassword(initAdminPassword)) {
        const existingByPhone = await tx.query('SELECT id FROM users WHERE phone = $1', [initAdminPhone]);
        const newHash = hashPassword(initAdminPassword);
        if (existingByPhone.rowCount > 0) {
          await tx.query(
            `UPDATE users
             SET role = 'Admin', phone_valid = 1, password_hash = $1, must_change_password = 0, active = 1
             WHERE id = $2`,
            [newHash, Number(existingByPhone.rows[0].id)]
          );
        } else {
          const adminRow = await tx.query("SELECT id FROM users WHERE role = 'Admin' ORDER BY id ASC LIMIT 1");
          if (adminRow.rowCount > 0) {
            await tx.query(
              `UPDATE users
               SET name = $1, phone = $2, phone_valid = 1, password_hash = $3, must_change_password = 0, active = 1
               WHERE id = $4`,
              [initAdminName, initAdminPhone, newHash, Number(adminRow.rows[0].id)]
            );
          } else {
            await tx.query(
              `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
               VALUES ($1, $2, 'Admin', $3, 1, $4, 0, 1, 1, $5)`,
              [900, initAdminName, initAdminPhone, newHash, new Date().toISOString().slice(0, 19).replace('T', ' ')]
            );
          }
        }
        console.log('[Security] Configured initial Admin account from INITIAL_ADMIN_PHONE environment config.');
      } else {
        console.warn('[Security] Ignored INITIAL_ADMIN_PHONE / INITIAL_ADMIN_PASSWORD: must be a valid 10-digit Indian mobile and non-demo password (min 8 chars).');
      }
    }

    // 5. Shops (seed only when shops table is empty AND in local SQLite dev mode)
    const existingShopsCountRes = await tx.query('SELECT COUNT(*) AS cnt FROM shops');
    const shouldSeedShops = Number(existingShopsCountRes.rows[0]?.cnt || 0) === 0 && !isCloudOrPostgres;
    if (shouldSeedShops) {
      for (const s of seedData.shops || []) {
        await tx.query(
          `INSERT INTO shops (shop_id, cluster_id, shop_name, shop_category, owner_name, contact1, contact2, latitude, longitude, address, pincode, payment_mode, created_by, photo, active, created_on, survey_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (shop_id) DO NOTHING`,
          [
            Number(s.shopid),
            Number(s.clusterid || 1),
            String(s.shopName || ''),
            String(s.shopCategory || 'Retail'),
            String(s.ownerName || ''),
            String(s.contact1 || ''),
            String(s.contact2 || ''),
            Number(s.latitude || 0),
            Number(s.longitude || 0),
            String(s.address || ''),
            String(s.pincode || ''),
            Number(s.paymentmode || 0),
            Number(s.createdby || 6),
            String(s.photo || 'no_image.jpg'),
            s.active !== undefined ? Number(s.active) : 1,
            String(s.createdon || '2026-04-01 10:00:00'),
            JSON.stringify(Array.isArray(s.survey) ? s.survey : [])
          ]
        );
      }
    }

    // 6. Orders & Order Items: Never seed fake demo order records.
    // Real orders must strictly originate from authenticated user placement or Admin order entry.

    // 7. Manager Assignments (only seed if table is currently empty AND in local SQLite dev mode)
    const existingAssignCount = await tx.query('SELECT COUNT(*) AS cnt FROM manager_assignments');
    const shouldSeedAssignments = Number(existingAssignCount.rows[0]?.cnt || 0) === 0 && !isCloudOrPostgres;
    if (shouldSeedAssignments) {
      const assignSource = (legacyConfig.managerAssignments && Object.keys(legacyConfig.managerAssignments).length > 0)
        ? legacyConfig.managerAssignments
        : (seedData.managerAssignments || {});
      for (const [mgrIdStr, agentIds] of Object.entries(assignSource)) {
        const mgrId = Number(mgrIdStr);
        if (Array.isArray(agentIds)) {
          for (const agId of agentIds) {
            await tx.query(
              `INSERT INTO manager_assignments (manager_id, agent_id)
               VALUES ($1, $2)
               ON CONFLICT (manager_id, agent_id) DO NOTHING`,
              [mgrId, Number(agId)]
            );
          }
        }
      }
    }

    // 8. Sales Targets (only seed if table is currently empty AND in local SQLite dev mode)
    const existingTargetCount = await tx.query('SELECT COUNT(*) AS cnt FROM sales_targets');
    const shouldSeedTargets = Number(existingTargetCount.rows[0]?.cnt || 0) === 0 && !isCloudOrPostgres;
    if (shouldSeedTargets) {
      const targetSource = Array.isArray(legacyConfig.salesTargets) && legacyConfig.salesTargets.length > 0
        ? legacyConfig.salesTargets
        : (seedData.salesTargets || []);
      for (const t of targetSource) {
        await tx.query(
          `INSERT INTO sales_targets (id, agent_id, manager_id, cluster_id, period, target_amount, item_targets_json, updated_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            Number(t.id),
            Number(t.agentId),
            Number(t.managerId || 100),
            Number(t.clusterId || 1),
            String(t.period || '2026-10'),
            Number(t.targetAmount || 0),
            JSON.stringify(Array.isArray(t.itemTargets) ? t.itemTargets : []),
            String(t.updatedAt || new Date().toISOString()),
            t.updatedBy ? Number(t.updatedBy) : null
          ]
        );
      }
    }

    // 9. Role Permissions
    const safeDefaultPerms = defaultRolePermissions || {
      Admin: { pages: ['items', 'admin-dashboard', 'manager-orders', 'reports', 'settings'], actions: ['manage_items', 'manage_daily_prices', 'approve_price_requests'] },
      'Sales Manager': { pages: ['items', 'manager-orders', 'reports'], actions: ['view_items', 'update_daily_prices', 'approve_price_requests'] },
      'Field Sales Agent': { pages: ['overview', 'order-entry'], actions: ['create_order'] },
      'Delivery Agent': { pages: ['delivery'], actions: ['update_delivery_status'] }
    };
    const rolePermsSource = {
      ...safeDefaultPerms,
      ...(legacyConfig.rolePermissions || {}),
      Admin: safeDefaultPerms.Admin,
      'Delivery Agent': legacyConfig.rolePermissions?.['Delivery Agent'] || safeDefaultPerms['Delivery Agent']
    };
    for (const [roleName, permsObj] of Object.entries(rolePermsSource)) {
      if (!permsObj) continue;
      await tx.query(
        `INSERT INTO role_permissions (role, pages_json, actions_json, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (role) DO NOTHING`,
        [
          roleName,
          JSON.stringify(permsObj.pages || []),
          JSON.stringify(permsObj.actions || []),
          new Date().toISOString()
        ]
      );
    }

    // 10. App Settings
    const existingSettings = await tx.query('SELECT setting_key FROM app_settings WHERE setting_key = $1', ['global']);
    if (existingSettings.rowCount === 0) {
      const initialSettings = {
        organizationName: 'LineCart Wholesale Logistics',
        currencySymbol: '₹',
        defaultTargetPeriod: new Date().toISOString().slice(0, 7),
        maintenanceMode: false,
        ...(legacyConfig.appSettings || {})
      };
      await tx.query(
        `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES ($1, $2, $3)`,
        ['global', JSON.stringify(initialSettings), new Date().toISOString()]
      );
    }

    // 11. Audit Logs
    const existingAudit = await tx.query('SELECT COUNT(*) AS cnt FROM audit_logs');
    if (Number(existingAudit.rows[0]?.cnt || 0) === 0 && Array.isArray(legacyConfig.auditLogs)) {
      for (const log of legacyConfig.auditLogs) {
        if (!log || !log.id) continue;
        await tx.query(
          `INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [
            String(log.id),
            String(log.timestamp || new Date().toISOString()),
            Number(log.adminId || 0),
            String(log.adminName || 'System'),
            String(log.action || 'EVENT'),
            String(log.targetType || 'System'),
            String(log.targetId || ''),
            typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details || '')
          ]
        );
      }
    }
  });

  // Also check any accounts already in DB that have phone_valid = 0
  const dbInvalidRes = await db.query(
    'SELECT id, name, role, phone FROM users WHERE phone_valid = 0 OR phone IS NULL'
  );
  const invalidMap = new Map();
  for (const item of invalidPhoneAccounts) {
    invalidMap.set(item.id, item);
  }
  for (const row of dbInvalidRes.rows) {
    if (!invalidMap.has(Number(row.id))) {
      invalidMap.set(Number(row.id), {
        id: Number(row.id),
        name: row.name,
        role: row.role,
        rawPhone: row.phone ? `${String(row.phone).slice(0, 2)}***` : '(missing)',
        reason: 'Account lacks a unique valid 10-digit Indian mobile number'
      });
    }
  }

  return {
    invalidPhoneAccounts: [...invalidMap.values()]
  };
}

/**
 * Load all current business & administrative state from the relational database.
 */
export async function loadDatabaseState(defaultRolePermissions = {}) {
  return await db.withClient(async (runner) => {
    const usersRes = await runner.query('SELECT * FROM users ORDER BY id ASC');
    const shopsRes = await runner.query('SELECT * FROM shops ORDER BY shop_id ASC');
    const ordersRes = await runner.query('SELECT * FROM orders ORDER BY serial_no DESC, order_id DESC');
    const orderItemsRes = await runner.query('SELECT * FROM order_items ORDER BY id ASC');
    const assignRes = await runner.query('SELECT * FROM manager_assignments ORDER BY manager_id ASC, agent_id ASC');
    const targetsRes = await runner.query('SELECT * FROM sales_targets ORDER BY id ASC');
    const permsRes = await runner.query('SELECT * FROM role_permissions');
    const settingsRes = await runner.query('SELECT * FROM app_settings WHERE setting_key = $1', ['global']);
    const auditRes = await runner.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500');
    const itemsRes = await runner.query('SELECT * FROM items ORDER BY item_id ASC');
    let clusterPricesRes = { rows: [] };
    let priceHistoryRes = { rows: [] };
    let priceRequestsRes = { rows: [] };
    try {
      clusterPricesRes = await runner.query('SELECT * FROM cluster_item_prices ORDER BY cluster_id ASC, item_id ASC');
    } catch {}
    try {
      priceHistoryRes = await runner.query('SELECT * FROM price_history ORDER BY created_at DESC LIMIT 500');
    } catch {}
    try {
      priceRequestsRes = await runner.query('SELECT * FROM price_requests ORDER BY created_at DESC LIMIT 1000');
    } catch {}

  const users = usersRes.rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    role: r.role,
    phone: r.phone || '',
    phoneValid: Number(r.phone_valid) === 1,
    passwordHash: r.password_hash || null,
    mustChangePassword: Number(r.must_change_password) === 1,
    clusterid: Number(r.cluster_id || 1),
    active: Number(r.active ?? 1),
    createdon: r.created_on || '2026-04-01 09:00:00'
  }));

  const shops = shopsRes.rows.map((r) => {
    let survey = [];
    try {
      survey = JSON.parse(r.survey_json || '[]');
    } catch {}
    return {
      shopid: Number(r.shop_id),
      clusterid: Number(r.cluster_id || 1),
      shopName: r.shop_name,
      shopCategory: r.shop_category || 'Retail',
      ownerName: r.owner_name || '',
      contact1: r.contact1 || '',
      contact2: r.contact2 || '',
      latitude: Number(r.latitude || 0),
      longitude: Number(r.longitude || 0),
      address: r.address || '',
      pincode: r.pincode || '',
      paymentmode: Number(r.payment_mode || 0),
      createdby: Number(r.created_by || 6),
      assignedAgentId: r.assigned_agent_id !== null && r.assigned_agent_id !== undefined
        ? Number(r.assigned_agent_id)
        : (r.created_by ? Number(r.created_by) : null),
      assigned_agent_id: r.assigned_agent_id !== null && r.assigned_agent_id !== undefined
        ? Number(r.assigned_agent_id)
        : (r.created_by ? Number(r.created_by) : null),
      photo: r.photo || 'no_image.jpg',
      active: Number(r.active ?? 1),
      createdon: r.created_on || '2026-04-01 10:00:00',
      survey
    };
  });

  const itemsByOrder = new Map();
  for (const row of orderItemsRes.rows) {
    const oid = String(row.order_id);
    if (!itemsByOrder.has(oid)) itemsByOrder.set(oid, []);
    let parsed = null;
    try {
      parsed = JSON.parse(row.item_json || '{}');
    } catch {}
    itemsByOrder.get(oid).push({
      ...(parsed || {}),
      itemid: Number(row.item_id),
      itemName: row.item_name,
      qty: Number(row.qty),
      price: Number(row.price),
      custprice: Number(row.cust_price),
      actprice: Number(row.act_price),
      requestedPrice: row.requested_price !== null && row.requested_price !== undefined ? Number(row.requested_price) : undefined,
      priceRequestStatus: row.price_request_status || undefined
    });
  }

  const orders = ordersRes.rows.map((r) => {
    const orderId = String(r.order_id);
    const orderList = itemsByOrder.get(orderId) || [];
    return {
      id: orderId,
      orderId,
      serialNo: Number(r.serial_no || 0),
      shopId: r.shop_short_id || `S${String(r.customer_id).padStart(3, '0')}`,
      customerId: Number(r.customer_id),
      customer: r.customer_name,
      shopCategory: r.shop_category || 'Retail',
      spersonid: Number(r.sperson_id),
      agentName: r.agent_name,
      clusterId: Number(r.cluster_id || 1),
      date: r.order_date,
      createdAt: r.created_at,
      status: r.status || 'In progress',
      itemsCount: Number(r.items_count || orderList.length),
      total: Number(r.total || 0),
      deliveryAgentId: r.delivery_agent_id !== null && r.delivery_agent_id !== undefined ? Number(r.delivery_agent_id) : null,
      deliveryReason: r.delivery_reason || null,
      deliveryNote: r.delivery_note || null,
      deliveryUpdatedAt: r.delivery_updated_at || null,
      deliveryUpdatedBy: r.delivery_updated_by !== null && r.delivery_updated_by !== undefined ? Number(r.delivery_updated_by) : null,
      paymentStatus: r.payment_status || 'Not collected',
      paymentAmountCollected: Number(r.payment_amount_collected || 0),
      paymentBalanceDue: r.payment_balance_due !== null && r.payment_balance_due !== undefined
        ? Number(r.payment_balance_due)
        : Math.max(0, Number(r.total || 0) - Number(r.payment_amount_collected || 0)),
      paymentCollectedAt: r.payment_collected_at || null,
      paymentCollectedBy: r.payment_collected_by !== null && r.payment_collected_by !== undefined ? Number(r.payment_collected_by) : null,
      paymentCollectedByName: r.payment_collected_by_name || null,
      idempotencyKey: r.idempotency_key || null,
      orderList
    };
  });

  const managerAssignments = {};
  for (const row of assignRes.rows) {
    const mgrId = Number(row.manager_id);
    if (!managerAssignments[mgrId]) managerAssignments[mgrId] = [];
    managerAssignments[mgrId].push(Number(row.agent_id));
  }

  const salesTargets = targetsRes.rows.map((r) => {
    let itemTargets = [];
    try {
      itemTargets = JSON.parse(r.item_targets_json || '[]');
    } catch {}
    return {
      id: Number(r.id),
      agentId: Number(r.agent_id),
      managerId: Number(r.manager_id || 100),
      clusterId: Number(r.cluster_id || 1),
      period: r.period,
      targetAmount: Number(r.target_amount || 0),
      itemTargets,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by ? Number(r.updated_by) : undefined
    };
  });

  const rolePermissions = { ...defaultRolePermissions };
  for (const row of permsRes.rows) {
    try {
      rolePermissions[row.role] = {
        pages: JSON.parse(row.pages_json || '[]'),
        actions: JSON.parse(row.actions_json || '[]')
      };
    } catch {}
  }
  if (defaultRolePermissions.Admin) {
    rolePermissions.Admin = defaultRolePermissions.Admin;
  }

  let appSettings = {
    organizationName: 'LineCart Wholesale Logistics',
    currencySymbol: '₹',
    defaultTargetPeriod: new Date().toISOString().slice(0, 7),
    maintenanceMode: false
  };
  if (settingsRes.rowCount > 0) {
    try {
      appSettings = { ...appSettings, ...JSON.parse(settingsRes.rows[0].setting_value_json || '{}') };
    } catch {}
  }

  const auditLogs = auditRes.rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    adminId: Number(r.admin_id || 0),
    adminName: r.admin_name || 'System',
    action: r.action,
    targetType: r.target_type || 'System',
    targetId: r.target_id || '',
    details: r.details || ''
  }));

  const items = itemsRes.rows.map((r) => ({
    itemId: Number(r.item_id),
    itemid: Number(r.item_id),
    itemName: r.item_name,
    itemImage: r.item_image || '',
    itemimage: r.item_image || '',
    qty: Number(r.qty || 0),
    price: Number(r.price || 0),
    cprice: Number(r.cprice || 0),
    kgsPerUnit: Number(r.kgs_per_unit || 50),
    kgsperunit: Number(r.kgs_per_unit || 50),
    remarks: Number(r.remarks || 0),
    unitType: r.unit_type || 'Kgs',
    active: Number(r.active ?? 1),
    updatedAt: r.updated_at || null,
    updatedBy: r.updated_by ? Number(r.updated_by) : null,
    updatedByName: r.updated_by_name || null,
    createdAt: r.created_at || null
  }));

  const clusterItemPrices = clusterPricesRes.rows.map((r) => ({
    id: r.id,
    clusterId: Number(r.cluster_id),
    itemId: Number(r.item_id),
    price: Number(r.price),
    effectiveDate: r.effective_date,
    updatedAt: r.updated_at,
    updatedBy: Number(r.updated_by),
    updatedByName: r.updated_by_name
  }));

  const priceHistory = priceHistoryRes.rows.map((r) => ({
    id: r.id,
    itemId: Number(r.item_id),
    clusterId: Number(r.cluster_id || 0),
    oldPrice: Number(r.old_price),
    newPrice: Number(r.new_price),
    effectiveDate: r.effective_date,
    createdAt: r.created_at,
    changedBy: Number(r.changed_by),
    changedByName: r.changed_by_name,
    idempotencyKey: r.idempotency_key || null
  }));

  const priceRequests = (priceRequestsRes.rows || []).map((r) => ({
    id: r.id,
    orderId: r.order_id,
    itemId: Number(r.item_id),
    shopId: Number(r.shop_id),
    clusterId: Number(r.cluster_id),
    agentId: Number(r.agent_id),
    requestedPrice: Number(r.requested_price),
    catalogPrice: Number(r.catalog_price),
    reason: r.reason || '',
    status: r.status || 'pending',
    createdAt: r.created_at,
    decisionBy: r.decision_by ? Number(r.decision_by) : null,
    decisionByName: r.decision_by_name || null,
    decisionAt: r.decision_at || null,
    decisionComment: r.decision_comment || null,
    applyToCatalog: Number(r.apply_to_catalog || 0) === 1,
    idempotencyKey: r.idempotency_key || null
  }));

    return {
      users,
      shops,
      orders,
      items,
      clusterItemPrices,
      priceHistory,
      priceRequests,
      managerAssignments,
      salesTargets,
      rolePermissions,
      appSettings,
      auditLogs
    };
  });
}

