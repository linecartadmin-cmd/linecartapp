import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { db, runMigrationsAndSeed, loadDatabaseState, isKnownDemoPassword } from './db.js';
import { createBackupSnapshot, validateSnapshot, restoreSnapshot, isLegacySnapshot, listTables, tableCounts, BACKUP_FORMAT } from './backup.js';
import * as seedData from './data.loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    break;
  }
}

// Staging and Render are protected like production (restore needs explicit flags there)
const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production' ||
  (process.env.APP_ENV || '').toLowerCase() === 'staging' ||
  Boolean(process.env.RENDER);

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
};

const verifyPassword = (password, storedValue, productionMode = isProduction) => {
  if (!storedValue || !password) return false;
  const strVal = String(storedValue);
  const strPwd = String(password);
  if (strVal.includes(':')) {
    const [salt, key] = strVal.split(':');
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(strPwd, salt, 64);
    if (keyBuffer.length !== derivedKey.length) return false;
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  }
  if (productionMode) return false;
  return strVal === strPwd;
};

const DEFAULT_ROLE_PERMISSIONS = {
  Admin: {
    pages: ['admin-dashboard', 'admin-users', 'admin-roles', 'admin-assignments', 'admin-targets', 'admin-orders', 'admin-reports', 'admin-shops', 'admin-audit', 'admin-settings'],
    actions: ['view_all_reports', 'export_reports', 'export_png', 'manage_users', 'manage_roles', 'manage_assignments', 'manage_targets', 'manage_settings', 'create_order', 'view_orders', 'view_shops']
  },
  'Sales Manager': {
    pages: ['manager-dashboard', 'manager-agents', 'manager-orders', 'manager-clusters', 'manager-targets', 'reports', 'customers', 'clusters'],
    actions: ['view_assigned_reports', 'export_reports', 'export_png', 'manage_targets', 'view_orders', 'view_shops', 'create_order']
  },
  'Field Sales Agent': {
    pages: ['dashboard', 'customers', 'add-customer', 'order', 'reports', 'clusters', 'targets'],
    actions: ['create_order', 'add_customer', 'view_own_reports', 'export_png', 'view_shops']
  },
  'Delivery Agent': {
    pages: ['delivery-home'],
    actions: ['view_assigned_deliveries', 'update_delivery_status', 'view_shops']
  }
};

function readSingleHiddenTtyLine(promptText) {
  return new Promise((resolve, reject) => {
    process.stdout.write(promptText);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        const code = ch.charCodeAt(0);
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (code === 3) {
          // Ctrl+C
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Aborted by user.'));
          return;
        }
        if (code === 8 || code === 127) {
          // Backspace / Delete
          if (value.length > 0) {
            value = value.slice(0, -1);
          }
          continue;
        }
        if (code >= 32) {
          value += ch;
        }
      }
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (typeof stdin.setRawMode === 'function') {
        try {
          stdin.setRawMode(Boolean(wasRaw));
        } catch {}
      }
      stdin.pause();
    };

    stdin.on('data', onData);
  });
}

function readSingleTtyLine(promptText) {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (chunk) => {
      const line = String(chunk).replace(/[\r\n]+$/, '');
      stdin.removeListener('data', onData);
      stdin.pause();
      resolve(line);
    };
    stdin.once('data', onData);
  });
}

async function promptForNewAdminPassword() {
  if (process.stdin.isTTY) {
    const first = await readSingleHiddenTtyLine('Enter new password for Admin (9870000001) [hidden]: ');
    const second = await readSingleHiddenTtyLine('Confirm new password for Admin (9870000001) [hidden]: ');
    return { first, second };
  }

  // Non-TTY stdin stream (for local piped automation without CLI args or echo)
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  }
  const lines = chunks.join('').replace(/\r\n/g, '\n').split('\n');
  const first = lines[0] || '';
  const second = lines.length > 1 && lines[1] !== '' ? lines[1] : first;
  return { first, second };
}

async function main() {
  const args = process.argv.slice(2);
  await db.init();

  const legacyAdminConfigPath = path.join(__dirname, 'admin_config.json');

  if (args.includes('--reset-admin-password')) {
    const extraArgs = args.filter((a) => a !== '--reset-admin-password');
    if (extraArgs.length > 0) {
      console.error('[Security Error] Do not pass the password on the command line. Run `node migrate.js --reset-admin-password` and enter the password at the hidden prompt.');
      await db.close();
      process.exit(1);
    }

    const adminRes = await db.query(
      "SELECT id, name, role, phone FROM users WHERE phone = $1 AND role = 'Admin' LIMIT 1",
      ['9870000001']
    );
    if (adminRes.rowCount === 0) {
      console.error('[Error] Admin account with mobile number 9870000001 was not found in the database.');
      await db.close();
      process.exit(1);
    }

    const adminUser = adminRes.rows[0];
    const { first, second } = await promptForNewAdminPassword();

    if (!first || first !== second) {
      console.error('[Validation Error] Passwords did not match or were empty. Admin password was not changed.');
      await db.close();
      process.exit(1);
    }

    if (first.length < 8) {
      console.error('[Validation Error] New password must be at least 8 characters long. Admin password was not changed.');
      await db.close();
      process.exit(1);
    }

    if (isKnownDemoPassword(first)) {
      console.error('[Validation Error] Known demo or weak default passwords cannot be used. Admin password was not changed.');
      await db.close();
      process.exit(1);
    }

    const newHash = hashPassword(first);
    let revokedCount = 0;

    await db.withTransaction(async (tx) => {
      await tx.query(
        "UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2 AND phone = '9870000001' AND role = 'Admin'",
        [newHash, Number(adminUser.id)]
      );
      const revRes = await tx.query(
        'UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL',
        [Date.now(), Number(adminUser.id)]
      );
      revokedCount = revRes.rowCount || 0;
      await tx.query('DELETE FROM login_attempts WHERE identifier = $1', ['9870000001']);
    });

    console.log(`[Admin Password Reset] Successfully updated password hash for Admin #${adminUser.id} (${adminUser.name}, ${adminUser.phone}).`);
    console.log(`[Admin Password Reset] Revoked ${revokedCount} active session(s). Shops, orders, targets, and audit logs were left unchanged.`);
    await db.close();
    return;
  }

  if (args.includes('--backup')) {
    // READ-ONLY: no migrations, no seeding, no writes to the database.
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const customIdx = args.indexOf('--backup') + 1;
    const outPath = (args[customIdx] && !args[customIdx].startsWith('--'))
      ? path.resolve(args[customIdx])
      : path.join(backupDir, `linecart-backup-${timestamp}.json`);

    const snapshot = await createBackupSnapshot(db);
    const tmpPath = `${outPath}.partial`;
    fs.writeFileSync(tmpPath, JSON.stringify(snapshot, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, outPath);
    console.log(`[Backup] Saved full backup (format v${snapshot.version}) to ${outPath}`);
    for (const [table, count] of Object.entries(snapshot.counts)) {
      console.log(`  ${table.padEnd(22)} ${String(count).padStart(8)} rows`);
    }
    console.log(`  checksum sha256 ${snapshot.checksum}`);
    console.warn('[Backup] This file contains customer data and password hashes. Store it privately and never commit it.');
    await db.close();
    return;
  }

  if (args.includes('--restore')) {
    const fileIdx = args.indexOf('--restore') + 1;
    const restoreFile = args[fileIdx];
    if (!restoreFile || !fs.existsSync(path.resolve(restoreFile))) {
      console.error('[Restore Error] Provide a valid path to a backup JSON file.');
      process.exit(1);
    }

    const hasForceFlag = args.includes('--force') || args.includes('--confirm-restore');
    const allowProd = args.includes('--allow-production-restore');

    // Safety Gate 1: Strict Production Environment Guard
    if (isProduction && !allowProd) {
      console.error('\n============================================================');
      console.error('[RESTORE BLOCKED] Production Safety Gate Violation');
      console.error('============================================================');
      console.error('The target environment is running in PRODUCTION mode (NODE_ENV=production).');
      console.error('To protect live operational data, destructive database restores are blocked.');
      console.error('If this is an intentional disaster recovery operation, you must explicitly supply:');
      console.error('  --allow-production-restore --force\n');
      process.exit(1);
    }

    // Mask any password in PostgreSQL connection URL
    const targetDesc = db.mode === 'postgres'
      ? (process.env.DATABASE_URL || '').replace(/:([^:@]+)@/, ':****@')
      : (db.dbPath || 'embedded SQLite');

    console.warn('\n============================================================');
    console.warn('[CAUTION: DESTRUCTIVE ACTION] DATABASE RESTORE');
    console.warn(`Target Engine: ${db.mode.toUpperCase()}`);
    console.warn(`Target DB:     ${targetDesc}`);
    console.warn(`Source File:   ${restoreFile}`);
    console.warn('WARNING: This will permanently DELETE all records in the target database');
    console.warn('and replace them with records from the snapshot.');
    console.warn('============================================================\n');

    // Safety Gate 2: Explicit Confirmation Guard
    if (!hasForceFlag) {
      if (process.stdin.isTTY) {
        const answer = await readSingleTtyLine("Type 'CONFIRM-RESTORE' to proceed with wiping and restoring: ");
        if (answer.trim() !== 'CONFIRM-RESTORE') {
          console.log('\n[Restore Aborted] Confirmation did not match "CONFIRM-RESTORE". No changes were made.\n');
          await db.close();
          return;
        }
        console.log('[Safety Gate Passed] Confirmation accepted. Proceeding with restore...\n');
      } else {
        console.error('[RESTORE BLOCKED] Safety Gate Violation:');
        console.error('Non-interactive execution requires an explicit confirmation flag.');
        console.error('Re-run with: --force or --confirm-restore\n');
        process.exit(1);
      }
    }

    const snapshot = JSON.parse(fs.readFileSync(path.resolve(restoreFile), 'utf8'));

    if (snapshot && snapshot.format === BACKUP_FORMAT) {
      // Full-fidelity restore (format v2): validate, then replace everything in ONE transaction.
      if (!(await listTables(db)).includes('users')) {
        // Fresh database: create the schema first (restore then replaces any seed rows)
        await runMigrationsAndSeed({ seedData, legacyAdminConfigPath, hashPassword, verifyPassword, isProduction, defaultRolePermissions: DEFAULT_ROLE_PERMISSIONS });
      }
      const check = await validateSnapshot(db, snapshot);
      for (const w of check.warnings) console.warn(`[Restore Warning] ${w}`);
      if (!check.ok) {
        for (const e of check.errors) console.error(`[Restore Error] ${e}`);
        console.error('[Restore Aborted] No changes were made.');
        await db.close();
        process.exit(1);
      }
      const restored = await restoreSnapshot(db, snapshot);
      const after = await tableCounts(db);
      let mismatch = false;
      for (const [table, count] of Object.entries(restored)) {
        const ok = after[table] === count;
        if (!ok) mismatch = true;
        console.log(`  ${table.padEnd(22)} ${String(count).padStart(8)} rows ${ok ? 'OK' : `MISMATCH (table has ${after[table]})`}`);
      }
      console.log(mismatch ? '[Restore] Completed with count mismatches. Investigate before use.' : `[Restore] Restored ${restoreFile}. All users must sign in again.`);
      await db.close();
      return;
    }

    if (!isLegacySnapshot(snapshot)) {
      console.error('[Restore Error] Unrecognised backup file. No changes were made.');
      await db.close();
      process.exit(1);
    }
    if (!args.includes('--accept-lossy')) {
      console.error('[RESTORE BLOCKED] This is an old-format backup. Restoring it LOSES data:');
      console.error('  - payment status, amounts collected and balances; GPS, visit photos and expected delivery dates');
      console.error('  - shop-to-agent assignments and customer price requests; items, daily prices and price history');
      console.error('  - audit entries beyond the newest 500');
      console.error('Use a backup made with the current `--backup`. To restore this file anyway, add --accept-lossy.');
      await db.close();
      process.exit(1);
    }
    console.warn('[Restore] --accept-lossy given: restoring an old-format backup with known data loss.');
    const migrationSql = fs.readFileSync(path.join(__dirname, 'migrations', '001_initial_schema.sql'), 'utf8');
    await db.execRaw(migrationSql);

    const t = snapshot.tables || {};
    await db.withTransaction(async (tx) => {
      await tx.query('DELETE FROM order_items');
      await tx.query('DELETE FROM orders');
      await tx.query('DELETE FROM shops');
      await tx.query('DELETE FROM sales_targets');
      await tx.query('DELETE FROM manager_assignments');
      await tx.query('DELETE FROM role_permissions');
      await tx.query('DELETE FROM app_settings');
      await tx.query('DELETE FROM audit_logs');
      await tx.query('DELETE FROM users');

      for (const u of t.users || []) {
        await tx.query(
          `INSERT INTO users (id, name, role, phone, phone_valid, password_hash, must_change_password, cluster_id, active, created_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [u.id, u.name, u.role, u.phone || null, u.phoneValid ? 1 : 0, u.passwordHash || null, u.mustChangePassword ? 1 : 0, u.clusterid || 1, u.active ?? 1, u.createdon || '2026-04-01 09:00:00']
        );
      }

      for (const s of t.shops || []) {
        await tx.query(
          `INSERT INTO shops (shop_id, cluster_id, shop_name, shop_category, owner_name, contact1, contact2, latitude, longitude, address, pincode, payment_mode, created_by, photo, active, created_on, survey_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [s.shopid, s.clusterid || 1, s.shopName, s.shopCategory || 'Retail', s.ownerName || '', s.contact1 || '', s.contact2 || '', s.latitude || 0, s.longitude || 0, s.address || '', s.pincode || '', s.paymentmode || 0, s.createdby || 6, s.photo || 'no_image.jpg', s.active ?? 1, s.createdon || '2026-04-01 10:00:00', JSON.stringify(s.survey || [])]
        );
      }

      let itemRowId = 0;
      for (const o of t.orders || []) {
        await tx.query(
          `INSERT INTO orders (order_id, serial_no, shop_short_id, customer_id, customer_name, shop_category, sperson_id, agent_name, cluster_id, order_date, created_at, status, items_count, total, delivery_agent_id, delivery_reason, delivery_note, delivery_updated_at, delivery_updated_by, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [o.orderId || o.id, o.serialNo || 0, o.shopId, o.customerId, o.customer, o.shopCategory || 'Retail', o.spersonid, o.agentName, o.clusterId || 1, o.date, o.createdAt, o.status || 'In progress', o.itemsCount || 0, o.total || 0, o.deliveryAgentId ?? null, o.deliveryReason || null, o.deliveryNote || null, o.deliveryUpdatedAt || null, o.deliveryUpdatedBy ?? null, o.idempotencyKey || null]
        );
        for (const item of o.orderList || []) {
          itemRowId += 1;
          await tx.query(
            `INSERT INTO order_items (id, order_id, item_id, item_name, qty, price, cust_price, act_price, item_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [itemRowId, o.orderId || o.id, item.itemid, item.itemName, item.qty, item.price || 0, item.custprice || 0, item.actprice || 0, JSON.stringify(item)]
          );
        }
      }

      for (const [mgrId, agentIds] of Object.entries(t.managerAssignments || {})) {
        for (const agId of agentIds || []) {
          await tx.query(
            'INSERT INTO manager_assignments (manager_id, agent_id) VALUES ($1, $2)',
            [Number(mgrId), Number(agId)]
          );
        }
      }

      for (const st of t.salesTargets || []) {
        await tx.query(
          `INSERT INTO sales_targets (id, agent_id, manager_id, cluster_id, period, target_amount, item_targets_json, updated_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [st.id, st.agentId, st.managerId || 100, st.clusterId || 1, st.period, st.targetAmount || 0, JSON.stringify(st.itemTargets || []), st.updatedAt || new Date().toISOString(), st.updatedBy ?? null]
        );
      }

      for (const [role, perms] of Object.entries(t.rolePermissions || {})) {
        await tx.query(
          'INSERT INTO role_permissions (role, pages_json, actions_json, updated_at) VALUES ($1, $2, $3, $4)',
          [role, JSON.stringify(perms.pages || []), JSON.stringify(perms.actions || []), new Date().toISOString()]
        );
      }

      if (t.appSettings) {
        await tx.query(
          'INSERT INTO app_settings (setting_key, setting_value_json, updated_at) VALUES ($1, $2, $3)',
          ['global', JSON.stringify(t.appSettings), new Date().toISOString()]
        );
      }

      for (const log of t.auditLogs || []) {
        await tx.query(
          `INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, target_type, target_id, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [log.id, log.timestamp, log.adminId || 0, log.adminName || 'System', log.action, log.targetType || 'System', log.targetId || '', log.details || '']
        );
      }
    });

    console.log(`[Restore] Successfully restored database from ${restoreFile}`);
    await db.close();
    return;
  }

  if (args.includes('--verify')) {
    const fileIdx = args.indexOf('--verify') + 1;
    const backupFile = args[fileIdx] && !args[fileIdx].startsWith('--') ? args[fileIdx] : null;
    let baseline = null;
    if (backupFile && fs.existsSync(path.resolve(backupFile))) {
      baseline = JSON.parse(fs.readFileSync(path.resolve(backupFile), 'utf8'));
    }

    // STRICTLY READ-ONLY: Never execute DDL (schema setup) or write operations in verify mode.
    // If schema setup is needed, run `node server/migrate.js` separately.
    if (baseline && baseline.format === BACKUP_FORMAT) {
      const current = await tableCounts(db);
      let allOk = true;
      console.log(`\n[DB Verification - READ ONLY] ${db.mode.toUpperCase()} vs ${backupFile}`);
      for (const table of new Set([...Object.keys(baseline.counts || {}), ...Object.keys(current)])) {
        const expected = baseline.counts?.[table];
        const actual = current[table];
        const ok = expected === actual;
        if (!ok) allOk = false;
        console.log(`  ${table.padEnd(22)} db ${String(actual ?? 'MISSING').padStart(8)}  backup ${String(expected ?? 'N/A').padStart(8)}  ${ok ? 'MATCH' : 'MISMATCH'}`);
      }
      console.log(allOk ? 'All table counts match the backup.' : 'Differences found.');
      await db.close();
      return;
    }
    const counts = {};
    const tables = [
      'users', 'shops', 'orders', 'order_items',
      'manager_assignments', 'sales_targets',
      'role_permissions', 'audit_logs', 'app_settings'
    ];
    for (const tbl of tables) {
      try {
        const res = await db.query(`SELECT COUNT(*) AS cnt FROM ${tbl}`);
        counts[tbl] = Number(res.rows[0]?.cnt || 0);
      } catch {
        counts[tbl] = null; // Table does not exist in target database
      }
    }

    console.log('\n============================================================');
    console.log(`[DB Verification - READ ONLY] Database Engine: ${db.mode.toUpperCase()}`);
    if (baseline) {
      console.log(`Baseline Snapshot: ${backupFile}`);
    }
    console.log('============================================================');
    console.log('Table                 Target DB Records   Baseline Snapshot    Status');
    console.log('--------------------------------------------------------------------');
    let allMatched = true;
    for (const tbl of tables) {
      const current = counts[tbl];
      let baseCount = 'N/A';
      let status = 'INFO';
      if (baseline?.tables) {
        if (tbl === 'users') baseCount = (baseline.tables.users || []).length;
        else if (tbl === 'shops') baseCount = (baseline.tables.shops || []).length;
        else if (tbl === 'orders') baseCount = (baseline.tables.orders || []).length;
        else if (tbl === 'order_items') {
          baseCount = (baseline.tables.orders || []).reduce((sum, o) => sum + (o.orderList || []).length, 0);
        }
        else if (tbl === 'manager_assignments') {
          baseCount = Object.values(baseline.tables.managerAssignments || {}).reduce((sum, arr) => sum + (arr || []).length, 0);
        }
        else if (tbl === 'sales_targets') baseCount = (baseline.tables.salesTargets || []).length;
        else if (tbl === 'role_permissions') baseCount = Object.keys(baseline.tables.rolePermissions || {}).length;
        else if (tbl === 'audit_logs') baseCount = (baseline.tables.auditLogs || []).length;
        else if (tbl === 'app_settings') baseCount = baseline.tables.appSettings ? 1 : 0;

        if (current === null) {
          status = 'TABLE MISSING';
          allMatched = false;
        } else {
          const match = current === baseCount;
          status = match ? '✔ MATCH' : 'MISMATCH';
          if (!match) allMatched = false;
        }
      } else if (current === null) {
        status = 'TABLE MISSING';
      }
      const currentDisplay = current === null ? 'MISSING' : String(current);
      console.log(`${tbl.padEnd(22)} ${currentDisplay.padStart(9)}       ${String(baseCount).padStart(9)}        ${status}`);
    }
    console.log('============================================================');
    if (baseline && allMatched) {
      console.log('🎉 Record counts match the baseline snapshot exactly!\n');
    } else if (baseline) {
      console.warn('⚠️ Discrepancies detected between target DB and baseline snapshot.\n');
    }
    await db.close();
    return;
  }

  // Default: Run repeatable migrations & seed
  const result = await runMigrationsAndSeed({
    seedData,
    legacyAdminConfigPath,
    hashPassword,
    verifyPassword,
    isProduction,
    defaultRolePermissions: DEFAULT_ROLE_PERMISSIONS
  });

  const state = await loadDatabaseState(DEFAULT_ROLE_PERMISSIONS);
  console.log('[DB Migration Summary]');
  console.log(`  Users:               ${state.users.length}`);
  console.log(`  Shops:               ${state.shops.length}`);
  console.log(`  Orders:              ${state.orders.length}`);
  console.log(`  Sales Targets:       ${state.salesTargets.length}`);
  console.log(`  Manager Assignments: ${Object.keys(state.managerAssignments).length} managers`);
  console.log(`  Audit Logs:          ${state.auditLogs.length}`);

  if (result.invalidPhoneAccounts.length > 0) {
    console.warn('\n[WARNING] Accounts requiring a valid 10-digit Indian mobile number before sign-in:');
    for (const acc of result.invalidPhoneAccounts) {
      console.warn(`  - ID #${acc.id} (${acc.name}, ${acc.role}): ${acc.reason}`);
    }
  } else {
    console.log('  Mobile Validation:   All migrated user accounts have unique valid 10-digit Indian mobile numbers (/^[6-9]\\d{9}$/).');
  }

  await db.close();
}

main().catch((err) => {
  console.error('[DB Migration Error]', err);
  process.exit(1);
});
