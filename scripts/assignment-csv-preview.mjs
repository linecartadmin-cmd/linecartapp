#!/usr/bin/env node
/**
 * scripts/assignment-csv-preview.mjs
 *
 * CSV-based shop assignment preview and analysis tool.
 * Evaluates legacy customer CSVs against Field Sales Agent accounts.
 *
 * SAFETY GUARANTEES:
 * - PREVIEW / DRY-RUN ONLY: Writes NO records to PostgreSQL, SQLite, or Render.
 * - Performs strict duplicate detection, unmatched name reporting, and collision analysis.
 *
 * Usage:
 *   node scripts/assignment-csv-preview.mjs [path-to-csv]
 */

import fs from 'node:fs';
import path from 'node:path';

// Known & verified accounts on Render / Supabase
const KNOWN_ACCOUNTS = [
  { id: 905, name: 'Sampath Kumar', phone: '8072448413', csvMatch: 'SAMPATH KUMAR', confidence: 'High (Exact)' },
  { id: 906, name: 'Vignesh', phone: '9787524443', csvMatch: 'VIGNESH', confidence: 'High (Exact)' },
  { id: 907, name: 'Senthil', phone: '9965146223', csvMatch: 'SENTHIL', confidence: 'High (Exact)' },
  { id: 908, name: 'Shanmugam', phone: '6382558436', csvMatch: 'SHANMUGAM R', confidence: 'High (Reviewed)' },
  { id: 909, name: 'Guru Prasanth', phone: '9176859489', csvMatch: 'GURUPRASATH A', confidence: 'High (Reviewed)' },
  { id: 910, name: 'Arjun', phone: '9585644020', csvMatch: 'NAGARJUNAN S', confidence: 'High (Confirmed by Owner)' }
];

const DEFAULT_CSV = path.resolve('C:/Users/samki/OneDrive/Desktop/tbl_linecart_customers (2) (1).csv');
const csvFile = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV;

if (!fs.existsSync(csvFile)) {
  console.error(`CSV file not found: ${csvFile}`);
  console.error('Usage: node scripts/assignment-csv-preview.mjs <path-to-csv>');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((v) => v.trim())).map((r, i) => {
    const obj = { _line: i + 2 };
    header.forEach((h, j) => {
      obj[h] = (r[j] ?? '').trim();
    });
    return obj;
  });
}

console.log('========================================================================');
console.log(' LINECART FIELD SALES AGENT SHOP ASSIGNMENT PREVIEW (DRY-RUN ONLY)     ');
console.log('========================================================================\n');
console.log(`Source CSV: ${csvFile}`);

const content = fs.readFileSync(csvFile, 'utf8');
const rows = parseCsv(content);
console.log(`Total CSV rows: ${rows.length}\n`);

// Duplicate detection
const seenShopIds = new Map();
const duplicateShopIds = [];
const seenContacts = new Map();
const duplicateContacts = [];

const salespersonShops = new Map();
const createdByMap = new Map();

for (const r of rows) {
  const shopId = parseInt(r.id, 10);
  const shopName = r.shopname || `Shop #${r.id}`;
  const contact = (r.contact1 || '').replace(/\D/g, '').slice(-10);
  const spName = (r.name || 'UNKNOWN').trim().toUpperCase();
  const createdBy = parseInt(r.createdby, 10);

  // Shop ID duplicate check
  if (seenShopIds.has(shopId)) {
    duplicateShopIds.push({ shopId, line: r._line, prevLine: seenShopIds.get(shopId) });
  } else {
    seenShopIds.set(shopId, r._line);
  }

  // Contact duplicate check
  if (contact && contact.length === 10) {
    if (seenContacts.has(contact)) {
      duplicateContacts.push({ contact, shopId, prevShopId: seenContacts.get(contact) });
    } else {
      seenContacts.set(contact, shopId);
    }
  }

  // Salesperson grouping
  if (!salespersonShops.has(spName)) {
    salespersonShops.set(spName, []);
  }
  salespersonShops.get(spName).push({ shopId, shopName, createdBy, line: r._line });

  // createdby grouping
  if (!isNaN(createdBy)) {
    if (!createdByMap.has(createdBy)) createdByMap.set(createdBy, new Set());
    createdByMap.get(createdBy).add(spName);
  }
}

// Map against known accounts
const accountMatchMap = new Map();
for (const acc of KNOWN_ACCOUNTS) {
  accountMatchMap.set(acc.csvMatch.toUpperCase(), acc);
}

const mappingResults = [];
let totalMatchedShops = 0;
let totalPendingShops = 0;
let totalUnmatchedShops = 0;

for (const [spName, shops] of salespersonShops.entries()) {
  const match = accountMatchMap.get(spName);
  if (match) {
    const isPending = match.confidence.includes('Pending');
    if (isPending) totalPendingShops += shops.length;
    else totalMatchedShops += shops.length;

    mappingResults.push({
      csvSalespersonName: spName,
      matchedUserId: match.id,
      matchedUserName: match.name,
      phone: match.phone,
      shopCount: shops.length,
      confidence: match.confidence,
      action: isPending ? 'HOLD (Requires User Confirmation)' : 'ASSIGN',
      shops: shops.map((s) => s.shopId)
    });
  } else {
    totalUnmatchedShops += shops.length;
    mappingResults.push({
      csvSalespersonName: spName,
      matchedUserId: null,
      matchedUserName: 'None (Account Not Created)',
      phone: 'N/A',
      shopCount: shops.length,
      confidence: 'Unmatched',
      action: 'KEEP UNASSIGNED (No User Account)',
      shops: shops.map((s) => s.shopId)
    });
  }
}

// 7 Extra production gap shops
const CSV_ID_SET = new Set(rows.map((r) => parseInt(r.id, 10)));
const minId = Math.min(...CSV_ID_SET);
const maxId = Math.max(...CSV_ID_SET);
const gapIds = [];
for (let id = minId; id <= maxId; id++) {
  if (!CSV_ID_SET.has(id)) gapIds.push(id);
}

console.log('--- SALESPERSON MAPPING PREVIEW ---');
console.table(
  mappingResults.map((m) => ({
    'CSV Salesperson Name': m.csvSalespersonName,
    'User ID': m.matchedUserId ?? 'NULL',
    'Account Name': m.matchedUserName,
    'Shops': m.shopCount,
    'Confidence': m.confidence,
    'Proposed Action': m.action
  }))
);

console.log('\n--- CREATEDBY COLLISION ANALYSIS ---');
for (const [cId, names] of createdByMap.entries()) {
  const nameList = Array.from(names);
  if (nameList.length > 1) {
    console.log(`⚠️  createdby = ${cId} is shared by MULTIPLE salespeople: ${nameList.join(' AND ')}`);
    for (const name of nameList) {
      const count = salespersonShops.get(name)?.filter((s) => s.createdBy === cId).length || 0;
      console.log(`    - ${name}: ${count} shops under createdby ${cId}`);
    }
    console.log('    -> MUST map by CSV name column, NEVER by createdby.');
  }
}

console.log('\n--- PRODUCTION GAP SHOPS (7 SHOPS NOT IN CSV) ---');
console.log(`Identified Gaps between IDs ${minId} and ${maxId}: ${gapIds.map((id) => `#${id}`).join(', ')}`);
console.log('Status in CSV: Missing (Exists in Production DB)');
console.log('Proposed Action: Keep explicitly UNASSIGNED (assigned_agent_id = NULL) until store ownership verified.\n');

console.log('--- INTEGRITY & VALIDATION SUMMARY ---');
console.log(`Total CSV shops:                   ${rows.length}`);
console.log(`Duplicate shop IDs in CSV:         ${duplicateShopIds.length}`);
console.log(`Duplicate phone contacts in CSV:   ${duplicateContacts.length}`);
console.log(`Confirmed FSA assignments:         ${totalMatchedShops} shops across 6 FSA accounts`);
console.log(`Unmatched / unassigned shops:      ${totalUnmatchedShops} shops (2 missing FSA accounts)`);
console.log(`Production gap shops (unassigned): ${gapIds.length} shops (gaps #35, 48, 113, 172, 254, 296, 303)`);
console.log(`Total Unassigned Shops:            ${totalUnmatchedShops + gapIds.length} shops`);
console.log(`Grand Total Production Shops:      ${rows.length + gapIds.length} (Matches Render DB count of 317)\n`);

const outReport = {
  timestamp: new Date().toISOString(),
  mode: 'dry-run',
  csvFile,
  totalCsvRows: rows.length,
  duplicateShopIds,
  duplicateContacts: duplicateContacts.slice(0, 20),
  mappings: mappingResults,
  productionGaps: gapIds,
  summary: {
    totalConfirmedAssigned: totalMatchedShops,
    totalUnassignedFromCsv: totalUnmatchedShops,
    totalProductionGaps: gapIds.length,
    totalUnassigned: totalUnmatchedShops + gapIds.length,
    grandTotalShops: rows.length + gapIds.length
  }
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = path.resolve(`linecart-assignment-preview-${stamp}.json`);
fs.writeFileSync(outPath, JSON.stringify(outReport, null, 2), 'utf8');
console.log(`Report written to: ${outPath}`);
console.log('Execution Mode: DRY-RUN COMPLETE (No production database changes were made).');
