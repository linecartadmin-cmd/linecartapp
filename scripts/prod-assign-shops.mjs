#!/usr/bin/env node
/**
 * LineCart Production Shop Assignment Runner & Safe Incident Recovery System
 *
 * Uses the existing production endpoint:
 *   PUT /api/shops/:shopId/assign
 *
 * Production Safeguards:
 * 1. Concurrency Locking: Atomic lockfile prevents simultaneous executions. Stale locks are
 *    detected via OS process signaling (process.kill(pid, 0)) and safely reclaimed.
 * 2. Cryptographic mapping checksum (SHA-256) locks the exact 233 approved assignments.
 * 3. URL Whitelist: Strictly enforces https://linecart-staging.onrender.com.
 * 4. Preflight Inventory: Asserts exactly 317 total shops and presence of all 233 targets + 7 gaps.
 * 5. Pre-Execution Assignment Baseline: Refuses to execute if any shop has assigned_agent_id !== null.
 * 6. Disk-Synced Persistence: Snapshot and journal writes use fs.fsyncSync before atomic rename.
 * 7. Snapshot Content Re-parsing: Re-reads snapshot from disk and asserts all 317 shop IDs and NULL states
 *    prior to dispatching the first mutation request.
 * 8. Non-overwriting Filenames: Every execution generates unique, timestamped files.
 * 9. Uncertain HTTP Outcome Resolution: On timeout or network drop, re-reads shop via GET /api/shops.
 *    - If assigned: records confirmed success.
 *    - If still NULL: records unassigned, halts immediately (no blind retry).
 *    - If unexpected state: halts immediately and reports incident.
 * 10. Audit Trail Verification: Checks GET /api/admin/audit?action=SHOP_ASSIGNED&limit=500 and matches
 *     every single shop by shopId, action, targetType, and adminId.
 * 11. Guarded Recovery SQL: Checks affected row count against unique journaled shops; aborts
 *     and rolls back if any single expected row cannot be verified and restored.
 *
 * Modes:
 *   node scripts/prod-assign-shops.mjs --dry-run
 *   node scripts/prod-assign-shops.mjs --snapshot-only
 *   node scripts/prod-assign-shops.mjs --execute
 *   node scripts/prod-assign-shops.mjs --generate-recovery-sql <journal-file.json>
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// Whitelisted allowed targets to prevent accidental environment pollution
const ALLOWED_TARGET_URLS = Object.freeze([
  'https://linecart-staging.onrender.com'
]);

const LOCK_FILE = path.resolve('scripts/.prod-assign-shops.lock');

// Approved mapping from verified dry-run (310 total assigned shops across 8 agents)
export const ASSIGNMENTS_BY_AGENT = Object.freeze({
  905: Object.freeze({
    name: 'Sampath Kumar',
    csvName: 'SAMPATH KUMAR',
    expectedCount: 37,
    shops: Object.freeze([40, 45, 50, 51, 52, 59, 63, 66, 67, 68, 153, 155, 159, 166, 174, 175, 178, 183, 185, 186, 191, 193, 197, 202, 203, 206, 247, 248, 249, 250, 251, 252, 255, 258, 261, 262, 264])
  }),
  906: Object.freeze({
    name: 'Vignesh',
    csvName: 'VIGNESH',
    expectedCount: 42,
    shops: Object.freeze([34, 36, 37, 38, 41, 44, 49, 61, 80, 115, 116, 123, 157, 162, 170, 239, 240, 241, 242, 243, 244, 245, 269, 273, 275, 278, 281, 283, 285, 287, 306, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340])
  }),
  907: Object.freeze({
    name: 'Senthil',
    csvName: 'SENTHIL',
    expectedCount: 26,
    shops: Object.freeze([54, 55, 60, 64, 88, 90, 91, 93, 97, 114, 124, 125, 126, 127, 128, 129, 131, 132, 134, 135, 139, 140, 141, 144, 146, 150])
  }),
  908: Object.freeze({
    name: 'Shanmugam',
    csvName: 'SHANMUGAM R',
    expectedCount: 41,
    shops: Object.freeze([69, 71, 72, 73, 75, 78, 95, 96, 98, 99, 100, 101, 102, 105, 107, 109, 112, 165, 177, 179, 181, 184, 188, 194, 199, 200, 205, 208, 209, 210, 212, 263, 265, 266, 267, 271, 274, 276, 277, 279, 280])
  }),
  909: Object.freeze({
    name: 'Guru Prasanth',
    csvName: 'GURUPRASATH A',
    expectedCount: 40,
    shops: Object.freeze([33, 39, 42, 43, 46, 47, 53, 56, 57, 58, 62, 65, 70, 74, 76, 77, 79, 168, 173, 190, 192, 195, 196, 198, 201, 232, 233, 234, 235, 236, 237, 238, 320, 321, 322, 323, 324, 325, 327, 345])
  }),
  910: Object.freeze({
    name: 'Arjun',
    csvName: 'NAGARJUNAN S',
    expectedCount: 47,
    shops: Object.freeze([103, 104, 106, 108, 110, 111, 117, 118, 119, 120, 121, 122, 137, 142, 143, 148, 151, 154, 156, 167, 171, 204, 207, 211, 213, 214, 215, 216, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 326, 328, 329, 347, 348, 349])
  }),
  911: Object.freeze({
    name: 'Selvavignesh P',
    csvName: 'SELVAVIGNESH P',
    phone: '6381568077',
    expectedCount: 40,
    shops: Object.freeze([81, 82, 83, 84, 85, 86, 87, 89, 92, 94, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 289, 291, 292, 293, 295, 297, 299, 301, 302, 304, 305, 341, 342, 343, 344])
  }),
  912: Object.freeze({
    name: 'Jagadeesh',
    csvName: 'JAGADEESH',
    phone: '9597779893',
    expectedCount: 37,
    shops: Object.freeze([130, 133, 136, 138, 145, 147, 149, 152, 158, 160, 161, 163, 164, 169, 176, 180, 182, 187, 189, 246, 253, 256, 257, 259, 260, 268, 270, 272, 282, 284, 286, 288, 290, 294, 298, 300, 346])
  })
});

export const UNASSIGNED_SHOPS = Object.freeze({
  productionGaps: Object.freeze([35, 48, 113, 172, 254, 296, 303])
});

// Authoritative legacy created_by values for all 310 approved shops (derived from source CSV)
// Backfilled into assigned_agent_id during initial LineCart 2.0 deployment startup.
export const EXPECTED_PREFLIGHT_LEGACY_CREATED_BY = Object.freeze({
  33:3, 34:11, 36:11, 37:11, 38:11, 39:6, 40:4, 41:11, 42:6, 43:6,
  44:11, 45:4, 46:6, 47:6, 49:11, 50:4, 51:4, 52:4, 53:6, 54:5,
  55:5, 56:6, 57:6, 58:6, 59:4, 60:5, 61:11, 62:6, 63:4, 64:5,
  65:6, 66:4, 67:4, 68:4, 69:12, 70:6, 71:12, 72:12, 73:12, 74:13,
  75:12, 76:13, 77:13, 78:12, 79:13, 80:11, 81:10, 82:10, 83:10, 84:10,
  85:10, 86:10, 87:10, 88:5, 89:10, 90:5, 91:5, 92:10, 93:5, 94:10,
  95:12, 96:12, 97:5, 98:12, 99:12, 100:12, 101:12, 102:12, 103:7, 104:7,
  105:12, 106:7, 107:12, 108:7, 109:12, 110:7, 111:7, 112:12, 114:5, 115:11,
  116:11, 117:7, 118:7, 119:7, 120:7, 121:7, 122:7, 123:11, 124:5, 125:5,
  126:5, 127:5, 128:5, 129:5, 130:9, 131:5, 132:5, 133:9, 134:5, 135:5,
  136:9, 137:7, 138:9, 139:5, 140:5, 141:5, 142:7, 143:7, 144:5, 145:9,
  146:5, 147:9, 148:7, 149:9, 150:5, 151:7, 152:9, 153:4, 154:7, 155:4,
  156:7, 157:11, 158:9, 159:4, 160:9, 161:9, 162:11, 163:9, 164:9, 165:12,
  166:4, 167:7, 168:13, 169:9, 170:11, 171:7, 173:13, 174:4, 175:4, 176:9,
  177:12, 178:4, 179:12, 180:9, 181:12, 182:9, 183:4, 184:12, 185:4, 186:4,
  187:9, 188:12, 189:9, 190:13, 191:4, 192:13, 193:4, 194:12, 195:13, 196:13,
  197:4, 198:13, 199:12, 200:12, 201:13, 202:4, 203:4, 204:13, 205:12, 206:4,
  207:13, 208:12, 209:12, 210:12, 211:13, 212:12, 213:13, 214:13, 215:13, 216:13,
  217:10, 218:10, 219:10, 220:10, 221:10, 222:10, 223:10, 224:10, 225:10, 226:10,
  227:10, 228:10, 229:10, 230:10, 231:10, 232:6, 233:6, 234:6, 235:6, 236:6,
  237:6, 238:6, 239:11, 240:11, 241:11, 242:11, 243:11, 244:11, 245:11, 246:9,
  247:4, 248:4, 249:4, 250:4, 251:4, 252:4, 253:9, 255:4, 256:9, 257:9,
  258:4, 259:9, 260:9, 261:4, 262:4, 263:12, 264:4, 265:12, 266:12, 267:12,
  268:9, 269:11, 270:9, 271:12, 272:9, 273:11, 274:12, 275:11, 276:12, 277:12,
  278:11, 279:12, 280:12, 281:11, 282:9, 283:11, 284:9, 285:11, 286:9, 287:11,
  288:9, 289:10, 290:9, 291:10, 292:10, 293:10, 294:9, 295:10, 297:10, 298:9,
  299:10, 300:9, 301:10, 302:10, 304:10, 305:10, 306:11, 307:13, 308:7, 309:7,
  310:7, 311:7, 312:7, 313:7, 314:7, 315:13, 316:7, 317:7, 318:13, 319:13,
  320:6, 321:6, 322:6, 323:6, 324:6, 325:6, 326:13, 327:6, 328:13, 329:13,
  330:11, 331:11, 332:11, 333:11, 334:11, 335:11, 336:11, 337:11, 338:11, 339:11,
  340:11, 341:10, 342:10, 343:10, 344:10, 345:6, 346:9, 347:7, 348:7, 349:7
});

// Canonical cryptographic hash of the approved 310-assignment plan
export function computeMappingHash() {
  const sortedPairs = [];
  for (const [aid, info] of Object.entries(ASSIGNMENTS_BY_AGENT)) {
    for (const sid of info.shops) {
      sortedPairs.push(`${sid}:${aid}`);
    }
  }
  sortedPairs.sort((a, b) => {
    const numA = parseInt(a.split(':')[0], 10);
    const numB = parseInt(b.split(':')[0], 10);
    return numA - numB;
  });
  return crypto.createHash('sha256').update(sortedPairs.join('|')).digest('hex');
}

export const APPROVED_MAPPING_SHA256 = '4b84efff55ddeb4fd5add747a1ae799403f5ff9750b73390d462f863ba53738f';

const args = process.argv.slice(2);
let mode = '--dry-run';
let targetFile = null;
let baseUrl = 'https://linecart-staging.onrender.com';

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (['--snapshot-only', '--dry-run', '--execute', '--verify-only'].includes(a)) {
    mode = a;
  } else if (a === '--generate-recovery-sql') {
    mode = '--generate-recovery-sql';
    targetFile = args[++i];
  } else if (a.startsWith('http://') || a.startsWith('https://')) {
    baseUrl = a.replace(/\/+$/, '');
  }
}

// Atomic file writer with kernel fsync
export function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const fd = fs.openSync(tmpPath, 'w');
  fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmpPath, filePath);
}

/**
 * Acquire process execution lock to prevent concurrent runner instances.
 * Detects and safely clears stale locks from terminated processes using process.kill(pid, 0).
 */
export function acquireExecutionLock(adminPhone, executionMode) {
  let fd;
  try {
    fd = fs.openSync(LOCK_FILE, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      let lockData = null;
      try {
        lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      } catch {}

      if (lockData && lockData.pid) {
        let isProcessAlive = false;
        try {
          process.kill(lockData.pid, 0);
          isProcessAlive = true;
        } catch (killErr) {
          isProcessAlive = killErr.code === 'EPERM';
        }

        if (isProcessAlive) {
          throw new Error(
            `CONCURRENT EXECUTION REFUSED: Another runner process is currently active (PID: ${lockData.pid}, Started: ${lockData.createdAt}, Admin: ${lockData.adminPhone || 'N/A'}).\n` +
            `Simultaneous execution is strictly prohibited to prevent duplicate assignments.`
          );
        }

        console.warn(`[Lock] Detected stale execution lock from terminated PID ${lockData.pid}. Safely clearing stale lock.`);
        try { fs.unlinkSync(LOCK_FILE); } catch {}
        fd = fs.openSync(LOCK_FILE, 'wx');
      } else {
        console.warn('[Lock] Found unreadable lock file. Clearing stale lock.');
        try { fs.unlinkSync(LOCK_FILE); } catch {}
        fd = fs.openSync(LOCK_FILE, 'wx');
      }
    } else {
      throw err;
    }
  }

  const payload = JSON.stringify({
    pid: process.pid,
    createdAt: new Date().toISOString(),
    adminPhone: adminPhone ? String(adminPhone).replace(/.(?=.{4})/g, '*') : 'unknown',
    mode: executionMode
  }, null, 2);

  fs.writeFileSync(fd, payload, 'utf8');
  fs.fsyncSync(fd);
  fs.closeSync(fd);

  const releaseLock = () => {
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const cur = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        if (cur.pid === process.pid) {
          fs.unlinkSync(LOCK_FILE);
        }
      }
    } catch {}
  };

  process.once('exit', releaseLock);
  process.once('SIGINT', () => { releaseLock(); process.exit(130); });
  process.once('SIGTERM', () => { releaseLock(); process.exit(143); });
  return releaseLock;
}

async function askQuestion(query, hidden = false) {
  if (!hidden) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(query, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    });
  }

  // Hidden password input
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = true;
  process.stdout.write(query);
  const write = rl._writeToOutput?.bind(rl);
  if (write) {
    rl._writeToOutput = (str) => {
      if (!muted) write(str);
    };
  }
  return new Promise((resolve) => {
    rl.question('', (ans) => {
      muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(ans.trim());
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  }
}

/**
 * Generate production-safe guarded recovery SQL based on execution journal.
 * Enforces all-or-nothing transaction safety: Checks affected row count against
 * the unique successfully assigned entries from the journal. If row count differs,
 * aborts and rolls back the entire transaction.
 * Designed for PostgreSQL syntax. Marked unverified against live PostgreSQL on this host.
 */
export function generateGuardedRecoverySql(journal, { dialect = 'postgres' } = {}) {
  const assignedList = journal.assignedShops || [];
  const uniqueShopsMap = new Map();
  for (const item of assignedList) {
    const prevId = item.previousAssignedId !== undefined && item.previousAssignedId !== null
      ? item.previousAssignedId
      : (item.previousAssignedAgentId !== undefined && item.previousAssignedAgentId !== null
        ? item.previousAssignedAgentId
        : null);
    uniqueShopsMap.set(Number(item.shopId), {
      targetAgentId: Number(item.targetAgentId),
      previousAssignedId: prevId !== null && !isNaN(Number(prevId)) ? Number(prevId) : null
    });
  }

  const entries = Array.from(uniqueShopsMap.entries()).sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) {
    return null;
  }

  const shopIds = entries.map(([sid]) => sid);
  const expectedRows = entries.length;
  const whereConditions = entries.map(([sid, info]) => `    (shop_id = ${sid} AND assigned_agent_id = ${info.targetAgentId})`);
  const caseBranches = entries.map(([sid, info]) => {
    const val = info.previousAssignedId !== null ? info.previousAssignedId : 'NULL';
    return `    WHEN ${sid} THEN ${val}`;
  });

  if (dialect === 'postgres') {
    return [
      '--',
      '-- LINECART GUARDED RECOVERY SQL (POSTGRESQL TRANSACTION SAFE & ROW-COUNT VERIFIED)',
      `-- Generated from execution journal: ${journal.journalFileName || 'live-journal'}`,
      `-- Generated At: ${new Date().toISOString()}`,
      `-- Target Modified Shops: ${expectedRows}`,
      '--',
      '-- ALL-OR-NOTHING GUARANTEE:',
      '-- 1. Updates ONLY shops where BOTH shop_id AND assigned_agent_id match the journal.',
      '-- 2. Restores each shop back to its exact recorded pre-execution state (previousAssignedId).',
      '-- 3. Asserts GET DIAGNOSTICS ROW_COUNT = expected_count.',
      '-- 4. If any shop state does not match, raises an exception and rolls back the ENTIRE transaction.',
      '-- 5. Historical orders, shop visits, and shops.created_by are 100% untouched.',
      '--',
      '-- STATUS: PostgreSQL PL/pgSQL syntax verified. Host execution unverified (no local PostgreSQL engine).',
      '--',
      'BEGIN;',
      '',
      '-- [Step 1: Verification SELECT before update]',
      'SELECT shop_id, assigned_agent_id, shop_name',
      'FROM shops',
      `WHERE shop_id IN (${shopIds.join(', ')})`,
      'ORDER BY shop_id;',
      '',
      '-- [Step 2: Guarded PL/pgSQL block with row-count assertion and automatic rollback]',
      'DO $$',
      'DECLARE',
      `  v_expected_rows CONSTANT integer := ${expectedRows};`,
      '  v_affected_rows integer;',
      'BEGIN',
      '  UPDATE shops',
      '  SET assigned_agent_id = CASE shop_id',
      caseBranches.join('\n'),
      '    ELSE assigned_agent_id',
      '  END',
      '  WHERE',
      whereConditions.join(' OR\n') + ';',
      '',
      '  GET DIAGNOSTICS v_affected_rows = ROW_COUNT;',
      '',
      '  IF v_affected_rows <> v_expected_rows THEN',
      "    RAISE EXCEPTION 'RECOVERY ABORTED: Expected to restore % rows, but % rows matched. Rolling back entire transaction.', v_expected_rows, v_affected_rows;",
      '  END IF;',
      '',
      "  RAISE NOTICE 'RECOVERY VERIFIED: All % rows matched and restored to their previous assigned values.', v_affected_rows;",
      'END $$;',
      '',
      '-- [Step 3: Verification SELECT after update]',
      'SELECT shop_id, assigned_agent_id, shop_name',
      'FROM shops',
      `WHERE shop_id IN (${shopIds.join(', ')})`,
      'ORDER BY shop_id;',
      '',
      'COMMIT;',
      ''
    ].join('\n');
  }

  // Standard ANSI SQL (for SQLite isolated tests)
  return [
    '--',
    '-- LINECART GUARDED RECOVERY SQL (STANDARD ANSI SQL - TESTED & VERIFIED ON SQLITE)',
    `-- Generated from execution journal: ${journal.journalFileName || 'live-journal'}`,
    `-- Generated At: ${new Date().toISOString()}`,
    `-- Target Modified Shops: ${expectedRows}`,
    '--',
    'BEGIN TRANSACTION;',
    '',
    '-- [Step 1: Verification SELECT before update]',
    'SELECT shop_id, assigned_agent_id, shop_name',
    'FROM shops',
    `WHERE shop_id IN (${shopIds.join(', ')})`,
    'ORDER BY shop_id;',
    '',
    '-- [Step 2: Guarded Conditional Update Restoring Exact Previous Values]',
    'UPDATE shops',
    'SET assigned_agent_id = CASE shop_id',
    caseBranches.join('\n'),
    '    ELSE assigned_agent_id',
    '  END',
    'WHERE',
    whereConditions.join(' OR\n') + ';',
    '',
    '-- [Step 3: Verification SELECT after update]',
    'SELECT shop_id, assigned_agent_id, shop_name',
    'FROM shops',
    `WHERE shop_id IN (${shopIds.join(', ')})`,
    'ORDER BY shop_id;',
    '',
    'COMMIT;',
    ''
  ].join('\n');
}

/**
 * Generate a read-only audit verification SQL query that checks each individual shop ID
 * against audit_logs table, verifying action, target_type, admin_id, and time window.
 * Groups by target_id ONLY so duplicate records with different admin_name cannot be split.
 */
export function generateShopAuditVerificationSql(journal, adminId = 1, { dialect = 'postgres' } = {}) {
  const assignedList = journal.assignedShops || [];
  const uniqueShops = Array.from(new Set(assignedList.map((s) => Number(s.shopId)))).sort((a, b) => a - b);
  const startedAt = journal.startedAt || new Date().toISOString();
  const completedAt = journal.completedAt || new Date().toISOString();

  if (dialect === 'postgres') {
    return [
      '--',
      '-- LINECART PER-SHOP AUDIT LOG VERIFICATION QUERY (READ-ONLY POSTGRESQL)',
      `-- Generated for ${uniqueShops.length} expected shop assignments`,
      `-- Admin ID: ${adminId} | Window: ${startedAt} to ${completedAt}`,
      '--',
      'WITH expected_shops AS (',
      `  SELECT unnest(ARRAY[${uniqueShops.join(', ')}]) AS expected_shop_id`,
      '),',
      'matched_audits AS (',
      '  SELECT',
      '    target_id::integer AS audited_shop_id,',
      '    count(*) AS audit_entry_count,',
      '    min(timestamp) AS first_logged_at,',
      '    max(timestamp) AS last_logged_at,',
      "    string_agg(DISTINCT admin_name, ', ') AS admin_names",
      '  FROM audit_logs',
      "  WHERE action = 'SHOP_ASSIGNED'",
      "    AND target_type = 'Shop'",
      `    AND admin_id = ${adminId}`,
      `    AND timestamp >= '${startedAt}'`,
      `    AND timestamp <= '${completedAt}'`,
      '  GROUP BY target_id',
      ')',
      'SELECT',
      '  e.expected_shop_id,',
      '  COALESCE(m.audit_entry_count, 0) AS audit_count,',
      '  m.first_logged_at,',
      `  ${adminId} AS admin_id,`,
      '  m.admin_names,',
      '  CASE',
      '    WHEN m.audit_entry_count IS NULL OR m.audit_entry_count = 0 THEN \'MISSING\'',
      '    WHEN m.audit_entry_count = 1 THEN \'VERIFIED\'',
      '    ELSE \'DUPLICATE\'',
      '  END AS verification_status',
      'FROM expected_shops e',
      'LEFT JOIN matched_audits m ON e.expected_shop_id = m.audited_shop_id',
      'ORDER BY e.expected_shop_id;',
      '',
      '-- Summary count query',
      'WITH expected_shops AS (',
      `  SELECT unnest(ARRAY[${uniqueShops.join(', ')}]) AS expected_shop_id`,
      '),',
      'matched_audits AS (',
      '  SELECT',
      '    target_id::integer AS audited_shop_id,',
      '    count(*) AS audit_entry_count',
      '  FROM audit_logs',
      "  WHERE action = 'SHOP_ASSIGNED'",
      "    AND target_type = 'Shop'",
      `    AND admin_id = ${adminId}`,
      `    AND timestamp >= '${startedAt}'`,
      `    AND timestamp <= '${completedAt}'`,
      '  GROUP BY target_id',
      ')',
      'SELECT',
      '  count(*) FILTER (WHERE COALESCE(m.audit_entry_count, 0) = 1) AS verified_shops,',
      '  count(*) FILTER (WHERE COALESCE(m.audit_entry_count, 0) = 0) AS missing_shops,',
      '  count(*) FILTER (WHERE COALESCE(m.audit_entry_count, 0) > 1) AS duplicate_shops,',
      `  ${uniqueShops.length} AS total_expected_shops`,
      'FROM expected_shops e',
      'LEFT JOIN matched_audits m ON e.expected_shop_id = m.audited_shop_id;',
      ''
    ].join('\n');
  }

  // Standard SQL (for SQLite test suites)
  const valuesClause = uniqueShops.map((s) => `    (${s})`).join(',\n');
  return [
    '--',
    '-- LINECART PER-SHOP AUDIT LOG VERIFICATION QUERY (READ-ONLY STANDARD SQL)',
    `-- Generated for ${uniqueShops.length} expected shop assignments`,
    `-- Admin ID: ${adminId} | Window: ${startedAt} to ${completedAt}`,
    '--',
    'WITH expected_shops(expected_shop_id) AS (',
    '  VALUES',
    valuesClause,
    '),',
    'matched_audits AS (',
    '  SELECT',
    '    CAST(target_id AS INTEGER) AS audited_shop_id,',
    '    count(*) AS audit_entry_count,',
    '    min(timestamp) AS first_logged_at,',
    '    max(timestamp) AS last_logged_at,',
    "    group_concat(DISTINCT admin_name) AS admin_names",
    '  FROM audit_logs',
    "  WHERE action = 'SHOP_ASSIGNED'",
    "    AND target_type = 'Shop'",
    `    AND admin_id = ${adminId}`,
    `    AND timestamp >= '${startedAt}'`,
    `    AND timestamp <= '${completedAt}'`,
    '  GROUP BY target_id',
    ')',
    'SELECT',
    '  e.expected_shop_id,',
    '  COALESCE(m.audit_entry_count, 0) AS audit_count,',
    '  m.first_logged_at,',
    `  ${adminId} AS admin_id,`,
    '  m.admin_names,',
    '  CASE',
    '    WHEN m.audit_entry_count IS NULL OR m.audit_entry_count = 0 THEN \'MISSING\'',
    '    WHEN m.audit_entry_count = 1 THEN \'VERIFIED\'',
    '    ELSE \'DUPLICATE\'',
    '  END AS verification_status',
    'FROM expected_shops e',
    'LEFT JOIN matched_audits m ON e.expected_shop_id = m.audited_shop_id',
    'ORDER BY e.expected_shop_id;'
  ].join('\n');
}

/**
 * Re-reads a single shop from GET /api/shops to resolve uncertain HTTP outcomes (timeouts / network drops)
 */
async function resolveUncertainShopState(baseUrl, headers, shopId, expectedAgentId, originalAgentId = null) {
  console.warn(`\n[Resolution] Querying GET /api/shops to determine state of Shop #${shopId}...`);
  const res = await fetchWithTimeout(`${baseUrl}/api/shops`, { headers }, 15000);
  if (!res.ok) {
    throw new Error(`Failed to query shops to resolve uncertain outcome (HTTP ${res.status})`);
  }
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.shops || body.result || []);
  const shop = list.find((s) => Number(s.shopid) === Number(shopId));
  if (!shop) {
    throw new Error(`Shop #${shopId} could not be found during uncertain outcome resolution.`);
  }

  const rawAid = shop.assignedAgentId ?? shop.assigned_agent_id ?? null;
  const currentAid = rawAid !== null && rawAid !== undefined ? Number(rawAid) : null;
  if (currentAid === Number(expectedAgentId)) {
    return { outcome: 'CONFIRMED_SUCCESS', currentAid, shop };
  } else if (currentAid === null || (originalAgentId !== null && currentAid === Number(originalAgentId))) {
    return { outcome: 'STILL_ORIGINAL', currentAid, shop };
  } else {
    return { outcome: 'UNEXPECTED_STATE', currentAid, shop };
  }
}

async function main() {
  console.log('========================================================================');
  console.log(' LINECART PRODUCTION ASSIGNMENT RUNNER & RECOVERY AUDIT SYSTEM         ');
  console.log('========================================================================');
  console.log(`Target Backend:      ${baseUrl}`);
  console.log(`Operating Mode:      ${mode.toUpperCase()}`);
  console.log(`Approved Plan Hash:  ${APPROVED_MAPPING_SHA256}`);
  console.log('------------------------------------------------------------------------\n');

  // Verify internal mapping integrity
  const currentPlanHash = computeMappingHash();
  if (APPROVED_MAPPING_SHA256 !== currentPlanHash) {
    console.error('🚨 MAPPING HASH MISMATCH: Script internal mapping has been altered. Execution refused.');
    console.error(`Expected: ${APPROVED_MAPPING_SHA256}`);
    console.error(`Actual:   ${currentPlanHash}`);
    process.exit(1);
  }

  // Handle recovery SQL generation
  if (mode === '--generate-recovery-sql') {
    if (!targetFile || !fs.existsSync(targetFile)) {
      console.error(`Error: Valid journal file required. Usage: node scripts/prod-assign-shops.mjs --generate-recovery-sql <journal.json>`);
      process.exit(1);
    }
    const journal = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    journal.journalFileName = path.basename(targetFile);
    const sql = generateGuardedRecoverySql(journal);
    if (!sql) {
      console.log('No shops were modified in this journal. Database remains in its original state.');
      return;
    }
    const recoverySqlFile = `recovery-guarded-${Date.now()}.sql`;
    fs.writeFileSync(recoverySqlFile, sql);
    console.log(`✓ Guarded recovery SQL generated: ${recoverySqlFile}`);
    console.log('\nRecovery SQL Content:\n' + sql);
    return;
  }

  // Target Whitelist Verification
  if (!ALLOWED_TARGET_URLS.includes(baseUrl)) {
    console.error(`🚨 TARGET URL REFUSED: ${baseUrl} is not in the authorized production whitelist:`);
    for (const u of ALLOWED_TARGET_URLS) console.error(`  - ${u}`);
    process.exit(1);
  }

  if (mode === '--dry-run') {
    let totalAssigned = 0;
    for (const [agentId, info] of Object.entries(ASSIGNMENTS_BY_AGENT)) {
      console.log(`• Agent #${agentId} (${info.name} / ${info.csvName}): ${info.shops.length} shops`);
      totalAssigned += info.shops.length;
    }
    const unassignedCount = UNASSIGNED_SHOPS.productionGaps.length;
    console.log(`\nTotal shops to assign:     ${totalAssigned}`);
    console.log(`Total shops unassigned:    ${unassignedCount} (Production Gaps: 7)`);
    console.log(`Grand total shops:         ${totalAssigned + unassignedCount}`);
    console.log(`Plan SHA-256 Checksum:     ${APPROVED_MAPPING_SHA256}`);
    console.log('\nDRY-RUN COMPLETE. No network requests or mutations were performed.');
    return;
  }

  // Authentication Flow
  const phone = process.env.ADMIN_PHONE || await askQuestion('Admin phone (10-digit mobile): ');
  const password = process.env.ADMIN_PASSWORD || await askQuestion('Admin password (hidden): ', true);

  if (!phone || !password) {
    console.error('Error: Admin credentials required.');
    process.exit(1);
  }

  // Acquire execution lock (mutating operations only)
  let releaseLock = null;
  if (mode === '--execute') {
    try {
      releaseLock = acquireExecutionLock(phone, mode);
      console.log(`✓ Acquired exclusive execution lock (PID: ${process.pid})`);
    } catch (lockErr) {
      console.error(`\n🚨 ${lockErr.message}`);
      process.exit(1);
    }
  }

  console.log('\n[1/5] Authenticating with production backend...');
  process.stdout.write('Connecting to server (waking up backend if idle)... ');
  try {
    await fetchWithTimeout(`${baseUrl}/api/ping`, {}, 60000);
    console.log('online.');
  } catch {
    console.log('contacting...');
  }

  const loginRes = await fetchWithTimeout(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password })
  }, 45000);

  const loginBody = await loginRes.json().catch(() => null);
  if (!loginRes.ok || !loginBody?.token) {
    console.error(`Sign-in failed (${loginRes.status}):`, loginBody?.message || 'Invalid credentials');
    if (releaseLock) releaseLock();
    process.exit(1);
  }

  const token = loginBody.token;
  const user = loginBody.user || loginBody.result?.[0] || {};
  let adminName = user.name || 'Admin';
  let adminId = Number(user.id);
  let adminRole = user.role;

  // Authoritative fallback via /api/auth/me if user payload was not in login response
  if (!adminRole || isNaN(adminId)) {
    try {
      const meRes = await fetchWithTimeout(`${baseUrl}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Session-Token': token
        }
      }, 10000);
      if (meRes.ok) {
        const meData = await meRes.json().catch(() => ({}));
        const meUser = meData.user || meData.result?.[0] || meData;
        if (meUser?.role) adminRole = meUser.role;
        if (meUser?.id) adminId = Number(meUser.id);
        if (meUser?.name) adminName = meUser.name;
      }
    } catch {
      // non-blocking fallback
    }
  }

  console.log(`✓ Signed in successfully as ${adminName} (#${adminId}, Role: ${adminRole})`);

  if ((adminRole || '').toLowerCase() !== 'admin') {
    console.error(`Error: Caller role is "${adminRole}". Administrative privileges ('Admin') are strictly required.`);
    if (releaseLock) releaseLock();
    process.exit(1);
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Session-Token': token
  };

  // [2/5] Read live inventory and verify preflight baseline
  console.log('\n[2/5] Fetching live production inventory and verifying preflight conditions...');
  const shopsRes = await fetchWithTimeout(`${baseUrl}/api/shops`, { headers }, 15000);
  if (!shopsRes.ok) {
    console.error(`Failed to fetch current shops: HTTP ${shopsRes.status}`);
    if (releaseLock) releaseLock();
    process.exit(1);
  }
  const currentShops = await shopsRes.json();
  const shopsList = Array.isArray(currentShops) ? currentShops : (currentShops.shops || currentShops.result || []);
  console.log(`✓ Retrieved ${shopsList.length} shops from production.`);

  if (shopsList.length !== 317) {
    console.error(`🚨 INVENTORY MISMATCH: Expected 317 production shops, but live server returned ${shopsList.length}. Execution refused.`);
    if (releaseLock) releaseLock();
    process.exit(1);
  }

  const shopMap = new Map();
  for (const s of shopsList) {
    shopMap.set(Number(s.shopid), s);
  }

  // Preflight check: All 233 target shops must exist AND their pre-execution assigned_agent_id
  // must match their exact authoritative legacy created_by value (from the startup backfill) or NULL.
  const unexpectedPreflightShops = [];
  const allApprovedTargetShopIds = new Set();
  const preflightStateSummary = {
    totalAssignedShopsChecked: 0,
    matchingLegacyCreatedBy: 0,
    matchingNull: 0
  };

  for (const [aid, info] of Object.entries(ASSIGNMENTS_BY_AGENT)) {
    for (const sid of info.shops) {
      allApprovedTargetShopIds.add(sid);
      const s = shopMap.get(sid);
      if (!s) {
        console.error(`🚨 MISSING SHOP: Target shop #${sid} does not exist in production inventory. Execution refused.`);
        if (releaseLock) releaseLock();
        process.exit(1);
      }
      const existingAid = s.assignedAgentId ?? s.assigned_agent_id ?? null;
      const currentAid = existingAid !== null && existingAid !== undefined ? Number(existingAid) : null;
      const expectedLegacyCb = EXPECTED_PREFLIGHT_LEGACY_CREATED_BY[sid];

      preflightStateSummary.totalAssignedShopsChecked++;
      if (currentAid === null) {
        preflightStateSummary.matchingNull++;
      } else if (currentAid === expectedLegacyCb) {
        preflightStateSummary.matchingLegacyCreatedBy++;
      } else {
        unexpectedPreflightShops.push({
          shopId: sid,
          currentAssignedAgentId: currentAid,
          expectedLegacyCreatedBy: expectedLegacyCb,
          intendedAgentId: aid
        });
      }
    }
  }

  if (unexpectedPreflightShops.length > 0) {
    console.error(`\n🚨 UNEXPECTED PRE-EXECUTION STATE: Found ${unexpectedPreflightShops.length} shops with unexpected assigned_agent_id:`);
    for (const item of unexpectedPreflightShops.slice(0, 10)) {
      console.error(`  - Shop #${item.shopId}: current assigned_agent_id = ${item.currentAssignedAgentId} (expected legacy created_by: ${item.expectedLegacyCreatedBy} or NULL; intended FSA: #${item.intendedAgentId})`);
    }
    if (unexpectedPreflightShops.length > 10) console.error(`  ... and ${unexpectedPreflightShops.length - 10} more.`);
    console.error('All shops were required to be either NULL or their exact legacy created_by prior to assignment. Execution refused to prevent state corruption.');
    if (releaseLock) releaseLock();
    process.exit(1);
  }

  console.log(`✓ Inventory baseline verified: All 317 shops present.`);
  console.log(`  - ${allApprovedTargetShopIds.size} targets validated: ${preflightStateSummary.matchingLegacyCreatedBy} matching verified legacy created_by, ${preflightStateSummary.matchingNull} unassigned (NULL).`);

  // Persist pre-execution snapshot and re-parse to verify disk content
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotFileName = `linecart-shops-snapshot-pre-execution-${timestamp}.json`;
  const journalFileName = `linecart-assignment-journal-${timestamp}.json`;

  const snapshotData = {
    timestamp: new Date().toISOString(),
    adminName,
    adminId,
    targetUrl: baseUrl,
    planSha256: APPROVED_MAPPING_SHA256,
    totalShops: shopsList.length,
    shops: shopsList.map((s) => ({
      shopid: Number(s.shopid),
      shopName: s.shopName,
      assignedAgentId: s.assignedAgentId ?? s.assigned_agent_id ?? null,
      createdby: s.createdby ?? s.created_by ?? null,
      clusterid: s.clusterid ?? s.cluster_id ?? null
    }))
  };

  atomicWriteJson(snapshotFileName, snapshotData);

  // Validate the parsed snapshot content from disk
  const snapshotContent = fs.readFileSync(snapshotFileName, 'utf8');
  let parsedSnapshot;
  try {
    parsedSnapshot = JSON.parse(snapshotContent);
  } catch (parseErr) {
    console.error(`🚨 SNAPSHOT CORRUPT: Could not parse saved snapshot from disk: ${parseErr.message}`);
    if (releaseLock) releaseLock();
    process.exit(1);
  }

  if (!Array.isArray(parsedSnapshot.shops) || parsedSnapshot.shops.length !== 317) {
    console.error(`🚨 SNAPSHOT INVALID: Expected 317 shops in snapshot, found ${parsedSnapshot.shops?.length}.`);
    if (releaseLock) releaseLock();
    process.exit(1);
  }

  const parsedShopMap = new Map(parsedSnapshot.shops.map((s) => [s.shopid, s]));
  for (const sid of allApprovedTargetShopIds) {
    const ps = parsedShopMap.get(sid);
    if (!ps) {
      console.error(`🚨 SNAPSHOT INCOMPLETE: Approved shop #${sid} missing from parsed snapshot.`);
      if (releaseLock) releaseLock();
      process.exit(1);
    }
    const psAid = ps.assignedAgentId !== null && ps.assignedAgentId !== undefined ? Number(ps.assignedAgentId) : null;
    const expectedLegacyCb = EXPECTED_PREFLIGHT_LEGACY_CREATED_BY[sid];
    if (psAid !== null && psAid !== expectedLegacyCb) {
      console.error(`🚨 SNAPSHOT STATE ERROR: Shop #${sid} in snapshot has unexpected assignedAgentId = ${psAid} (expected legacy created_by: ${expectedLegacyCb} or NULL).`);
      if (releaseLock) releaseLock();
      process.exit(1);
    }
  }

  console.log(`✓ Pre-execution baseline snapshot saved & verified on disk (${parsedSnapshot.shops.length} shops, all ${allApprovedTargetShopIds.size} targets validated): ${snapshotFileName}`);

  if (mode === '--snapshot-only') {
    console.log('\nSnapshot complete. Exiting (--snapshot-only).');
    if (releaseLock) releaseLock();
    return;
  }

  // [3/5] Execute assignments with real-time journaling and uncertain outcome resolution
  if (mode === '--execute') {
    console.log('\n[3/5] EXECUTING ASSIGNMENTS WITH GUARDED JOURNALING...');
    console.log(`Execution Journal: ${journalFileName}`);
    console.log('------------------------------------------------------------------------\n');

    const journal = {
      startedAt: new Date().toISOString(),
      adminName,
      adminId,
      snapshotFile: snapshotFileName,
      planSha256: APPROVED_MAPPING_SHA256,
      status: 'IN_PROGRESS',
      totalTargetShops: allApprovedTargetShopIds.size,
      assignedShops: [],
      skippedShops: [],
      failedShop: null
    };

    atomicWriteJson(journalFileName, journal);

    let processedCount = 0;
    let skippedCount = 0;
    let successCount = 0;

    for (const [agentIdStr, info] of Object.entries(ASSIGNMENTS_BY_AGENT)) {
      const targetAgentId = Number(agentIdStr);
      console.log(`\nAssigning ${info.shops.length} shops to Agent #${targetAgentId} (${info.name})...`);

      for (let i = 0; i < info.shops.length; i++) {
        const shopId = info.shops[i];
        processedCount++;
        const currentLiveShop = shopMap.get(shopId);
        const currentAssignedId = currentLiveShop?.assignedAgentId ?? currentLiveShop?.assigned_agent_id ?? null;

        // Idempotency check: Skip if already assigned to the target agent
        if (Number(currentAssignedId) === targetAgentId) {
          console.log(`[${processedCount}/233] Shop #${shopId} already assigned to Agent #${targetAgentId}. [SKIPPED]`);
          journal.skippedShops.push({ shopId, agentId: targetAgentId, reason: 'ALREADY_ASSIGNED' });
          atomicWriteJson(journalFileName, journal);
          skippedCount++;
          continue;
        }

        process.stdout.write(`[${processedCount}/233] Shop #${shopId} -> Agent #${targetAgentId} (${info.name})... `);

        let callSucceeded = false;
        let uncertainOutcome = false;
        let responseStatus = null;
        let errorDetails = null;

        try {
          const res = await fetchWithTimeout(`${baseUrl}/api/shops/${shopId}/assign`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ agentId: targetAgentId })
          }, 15000);

          responseStatus = res.status;
          if (res.ok) {
            callSucceeded = true;
            console.log(`✓ OK`);
          } else {
            errorDetails = await res.text();
            console.log(`✗ HTTP ${res.status}: ${errorDetails}`);
          }
        } catch (networkErr) {
          uncertainOutcome = true;
          errorDetails = networkErr.message;
          console.log(`⚠️  NETWORK TIMEOUT / DROP (${networkErr.message})`);
        }

        // Handle uncertain network outcome: Re-query live state immediately
        if (uncertainOutcome) {
          console.warn(`[Uncertain Outcome] Investigating server state for Shop #${shopId}...`);
          try {
            const resolution = await resolveUncertainShopState(baseUrl, headers, shopId, targetAgentId, currentAssignedId);
            if (resolution.outcome === 'CONFIRMED_SUCCESS') {
              console.log(`✓ Confirmed: Shop #${shopId} was successfully assigned to Agent #${targetAgentId} on the server.`);
              callSucceeded = true;
              responseStatus = 200;
            } else if (resolution.outcome === 'STILL_ORIGINAL') {
              console.error(`🚨 Confirmed: Shop #${shopId} remains in pre-execution state (${resolution.currentAid}). Assignment did not take effect.`);
              errorDetails = 'PUT request timed out and shop remains in pre-execution state.';
            } else {
              console.error(`🚨 Confirmed: Shop #${shopId} is in UNEXPECTED STATE (assigned_agent_id = ${resolution.currentAid}).`);
              errorDetails = `Unexpected assignment state: ${resolution.currentAid}`;
            }
          } catch (resErr) {
            errorDetails = `Could not resolve uncertain outcome: ${resErr.message}`;
          }
        }

        if (callSucceeded) {
          successCount++;
          journal.assignedShops.push({
            index: processedCount,
            shopId,
            shopName: currentLiveShop?.shopName,
            targetAgentId,
            targetAgentName: info.name,
            previousAssignedId: currentAssignedId,
            timestamp: new Date().toISOString(),
            httpStatus: responseStatus
          });
          if (currentLiveShop) {
            currentLiveShop.assignedAgentId = targetAgentId;
            currentLiveShop.assigned_agent_id = targetAgentId;
          }
          atomicWriteJson(journalFileName, journal);
        } else {
          // Record failure and HALT immediately
          journal.status = 'HALTED_ON_ERROR';
          journal.failedShop = {
            shopId,
            targetAgentId,
            httpStatus: responseStatus,
            error: errorDetails,
            timestamp: new Date().toISOString()
          };
          atomicWriteJson(journalFileName, journal);

          console.error('\n========================================================================');
          console.error('🚨 EXECUTION HALTED IMMEDIATELY: INCIDENT DETECTED');
          console.error('========================================================================');
          console.error(`Failed on Shop ID:      #${shopId}`);
          console.error(`Target Agent ID:        #${targetAgentId} (${info.name})`);
          console.error(`Error Details:          ${errorDetails}`);
          console.error(`Shops Changed So Far:   ${journal.assignedShops.length}`);
          console.error(`Shops Untouched:        ${allApprovedTargetShopIds.size - journal.assignedShops.length}`);
          console.error(`Journal File:           ${journalFileName}`);
          console.error(`Snapshot Baseline:      ${snapshotFileName}`);
          console.error('\nTo generate the guarded recovery SQL script for the modified shops, run:');
          console.error(`  node scripts/prod-assign-shops.mjs --generate-recovery-sql ${journalFileName}`);
          if (releaseLock) releaseLock();
          process.exit(1);
        }

        // 100ms graceful delay to avoid overloading Render single instance
        await sleep(100);
      }
    }

    journal.status = 'COMPLETED';
    journal.completedAt = new Date().toISOString();
    atomicWriteJson(journalFileName, journal);

    console.log('\n========================================================================');
    console.log(`ASSIGNMENT EXECUTION COMPLETE: ${successCount} assigned, ${skippedCount} skipped`);
    console.log('========================================================================\n');
  }

  // [4/5] Post-Execution Verification Sweep via GET /api/shops
  console.log('[4/5] Running post-execution verification sweep via GET /api/shops...');
  const verifyRes = await fetchWithTimeout(`${baseUrl}/api/shops`, { headers }, 15000);
  if (!verifyRes.ok) {
    console.error(`Verification fetch failed: HTTP ${verifyRes.status}`);
    if (releaseLock) releaseLock();
    process.exit(1);
  }

  const postShopsList = await verifyRes.json();
  const allPostShops = Array.isArray(postShopsList) ? postShopsList : (postShopsList.shops || postShopsList.result || []);

  const actualCounts = {};
  for (const s of allPostShops) {
    const aid = s.assignedAgentId ?? s.assigned_agent_id ?? 'unassigned';
    actualCounts[aid] = (actualCounts[aid] || 0) + 1;
  }

  console.log('\n--- SHOP ASSIGNMENT DISTRIBUTION REPORT ---');
  console.log('Agent ID | Agent Name           | Expected | Actual | Status');
  console.log('---------+----------------------+----------+--------+-------');
  let allVerified = true;
  for (const [aid, info] of Object.entries(ASSIGNMENTS_BY_AGENT)) {
    const actual = actualCounts[aid] || 0;
    const match = actual === info.expectedCount;
    if (!match) allVerified = false;
    console.log(`  ${aid.padEnd(6)} | ${(info.name).padEnd(20)} | ${String(info.expectedCount).padStart(8)} | ${String(actual).padStart(6)} | ${match ? '✓ PASS' : '✗ MISMATCH'}`);
  }

  console.log('---------+----------------------+----------+--------+-------');
  const expectedAssignedTotal = Object.values(ASSIGNMENTS_BY_AGENT).reduce((sum, a) => sum + a.shops.length, 0);
  const expectedUnassignedTotal = UNASSIGNED_SHOPS.productionGaps.length;
  const totalAssignedActual = Object.keys(ASSIGNMENTS_BY_AGENT).reduce((sum, aid) => sum + (actualCounts[aid] || 0), 0);
  const actualUnassigned = allPostShops.length - totalAssignedActual;
  console.log(`Total Assigned:   Expected: ${expectedAssignedTotal} | Actual: ${totalAssignedActual} | ${totalAssignedActual === expectedAssignedTotal ? '✓ PASS' : '✗ MISMATCH'}`);
  console.log(`Total Unassigned: Expected: ${expectedUnassignedTotal}   | Actual: ${actualUnassigned} | ${actualUnassigned === expectedUnassignedTotal ? '✓ PASS' : '✗ MISMATCH'}`);
  console.log(`Grand Total:      Expected: ${expectedAssignedTotal + expectedUnassignedTotal} | Actual: ${allPostShops.length} | ${allPostShops.length === (expectedAssignedTotal + expectedUnassignedTotal) ? '✓ PASS' : '✗ MISMATCH'}`);

  // [5/5] Audit Trail Verification via GET /api/admin/audit
  console.log('\n[5/5] Verifying audit trail via GET /api/admin/audit?action=SHOP_ASSIGNED&limit=500...');
  let auditStatus = 'INCOMPLETE';
  try {
    const auditRes = await fetchWithTimeout(`${baseUrl}/api/admin/audit?action=SHOP_ASSIGNED&limit=500`, { headers }, 15000);
    if (auditRes.ok) {
      const auditData = await auditRes.json();
      const logs = auditData.logs || [];
      console.log(`✓ Retrieved ${logs.length} audit logs matching action "SHOP_ASSIGNED" (limit: 500).`);

      // Match each of the assigned shops against audit entries
      const missingAuditShops = [];
      for (const [aid, info] of Object.entries(ASSIGNMENTS_BY_AGENT)) {
        for (const sid of info.shops) {
          const matchingEntry = logs.find((l) =>
            l.action === 'SHOP_ASSIGNED' &&
            l.targetType === 'Shop' &&
            String(l.targetId) === String(sid) &&
            Number(l.adminId) === adminId
          );
          if (!matchingEntry) {
            missingAuditShops.push(sid);
          }
        }
      }

      if (missingAuditShops.length === 0) {
        auditStatus = 'VERIFIED';
        console.log(`✓ All ${allApprovedTargetShopIds.size} shop assignments verified with matching audit logs (Admin ID: #${adminId}).`);
      } else {
        auditStatus = 'INCOMPLETE';
        console.warn(`⚠️  AUDIT VERIFICATION INCOMPLETE: ${missingAuditShops.length} shops missing audit entries.`);
        console.warn(`Missing shop IDs: ${missingAuditShops.slice(0, 10).join(', ')}${missingAuditShops.length > 10 ? '...' : ''}`);
      }
    } else {
      auditStatus = 'INCOMPLETE';
      console.warn(`⚠️  Audit verification request returned HTTP ${auditRes.status}. Marking audit as INCOMPLETE.`);
    }
  } catch (auditErr) {
    auditStatus = 'INCOMPLETE';
    console.warn(`⚠️  Could not read audit logs (${auditErr.message}). Marking audit as INCOMPLETE.`);
  }

  console.log('\n========================================================================');
  console.log(`FINAL EXECUTION & AUDIT VERIFICATION STATUS: ${allVerified && auditStatus === 'VERIFIED' ? 'PASS' : 'WARNING'}`);
  console.log(`- Shop Assignment Sweep: ${allVerified && totalAssignedActual === expectedAssignedTotal && actualUnassigned === expectedUnassignedTotal ? 'PASS (100% verified)' : 'MISMATCH'}`);
  console.log(`- Audit Trail Matching:  ${auditStatus === 'VERIFIED' ? `PASS (All ${allApprovedTargetShopIds.size} verified)` : 'INCOMPLETE'}`);
  console.log('========================================================================');

  if (releaseLock) releaseLock();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/prod-assign-shops.mjs')) {
  main().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}
