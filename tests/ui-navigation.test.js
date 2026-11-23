/**
 * UI redesign Phase 1: navigation and permission consistency, back-button order, toast variants.
 * Pure client modules and source checks only (no server needed).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = path.join(repoRoot, 'client/src');
const load = (rel) => import(pathToFileURL(path.join(clientSrc, rel)).href);
const read = (rel) => fs.readFileSync(path.join(clientSrc, rel), 'utf8');

const { NAV, visibleNav, navPageIds, pageTitle } = await load('shell/navConfig.js');
const { registerOverlay, closeTopOverlay, hasOpenOverlay, closeLegacyModal } = await load('ui/overlayStack.js');
const { inferToastVariant, toastDuration } = await load('ui/toastVariant.js');

const appSrc = read('App.jsx');
const serverSrc = fs.readFileSync(path.join(repoRoot, 'server/index.js'), 'utf8');

function arrayLiteral(src, name) {
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `${name} found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
function serverDefaultPages(role) {
  const block = serverSrc.slice(serverSrc.indexOf('const DEFAULT_ROLE_PERMISSIONS'));
  const m = block.match(new RegExp(`'?${role}'?: \\{\\s*pages: \\[([^\\]]*)\\]`));
  assert.ok(m, `server default pages for ${role}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// Hash routes App.jsx accepts per role (hashchange handler)
const APP_VALID = {
  admin: arrayLiteral(appSrc, 'validAdminPages'),
  manager: arrayLiteral(appSrc, 'validManagerPages'),
  agent: arrayLiteral(appSrc, 'validAgentPages'),
  delivery: arrayLiteral(appSrc, 'validDeliveryPages')
};

// Destinations each role's navigation offered before the redesign (baseline, docs/ui-redesign/BASELINE.md)
const BASELINE_NAV = {
  admin: ['admin-dashboard', 'admin-users', 'admin-roles', 'admin-assignments', 'admin-targets', 'orders', 'price-requests', 'items', 'reports', 'map', 'field-visits', 'delivery', 'admin-audit', 'admin-settings'],
  manager: ['reports', 'orders', 'price-requests', 'items', 'map', 'field-visits', 'team', 'customers'],
  agent: ['overview', 'orders', 'visits', 'reports', 'customers', 'summary'],
  delivery: ['delivery']
};

describe('Role navigation matches the existing page ids and permissions', () => {
  for (const role of Object.keys(NAV)) {
    test(`${role}: same destinations as before the redesign (none added, none lost)`, () => {
      assert.deepStrictEqual([...navPageIds(role)].sort(), [...BASELINE_NAV[role]].sort());
    });

    test(`${role}: every destination is a hash route App.jsx accepts for this role`, () => {
      for (const id of navPageIds(role)) assert.ok(APP_VALID[role].includes(id), `${role} -> ${id}`);
    });

    test(`${role}: no duplicate entries, and a real title for every page`, () => {
      const ids = navPageIds(role);
      assert.strictEqual(new Set(ids).size, ids.length);
      for (const id of ids) assert.notStrictEqual(pageTitle(role, id), 'LineCart', `title for ${id}`);
    });

    test(`${role}: phone bar has at most 4 destinations plus More, and nothing is unreachable`, () => {
      const v = visibleNav(role, () => true);
      assert.ok(v.phone.length <= 4);
      const reachable = new Set([...v.phone, ...v.moreGroups.flatMap((g) => g.items)].map((i) => i.pageId));
      assert.deepStrictEqual([...reachable].sort(), [...navPageIds(role)].sort());
      assert.strictEqual(v.home, NAV[role].home);
    });
  }

  test('role homes are unchanged', () => {
    assert.deepStrictEqual(
      { admin: NAV.admin.home, manager: NAV.manager.home, agent: NAV.agent.home, delivery: NAV.delivery.home },
      { admin: 'admin-dashboard', manager: 'reports', agent: 'overview', delivery: 'delivery' }
    );
  });

  test('admin-only pages appear only in the Admin navigation', () => {
    for (const role of ['manager', 'agent', 'delivery']) {
      assert.ok(!navPageIds(role).some((id) => id.startsWith('admin-')), role);
    }
  });

  test('non-admin permission keys exist in the server default role permissions', () => {
    const map = { manager: 'Sales Manager', agent: 'Field Sales Agent', delivery: 'Delivery Agent' };
    for (const [role, serverRole] of Object.entries(map)) {
      const pages = serverDefaultPages(serverRole);
      for (const g of NAV[role].groups) {
        for (const item of g.items) {
          const key = item.perm || item.pageId;
          assert.ok(pages.includes(key), `${serverRole}: ${item.pageId} uses permission '${key}'`);
        }
      }
    }
  });

  test('Sales Manager price approvals stay gated by the orders permission, as before', () => {
    const item = NAV.manager.groups.flatMap((g) => g.items).find((i) => i.pageId === 'price-requests');
    assert.strictEqual(item.perm, 'orders');
    const v = visibleNav('manager', (key) => key !== 'orders');
    const ids = v.groups.flatMap((g) => g.items.map((i) => i.pageId));
    assert.ok(!ids.includes('price-requests') && !ids.includes('orders'));
  });

  test('a page the admin disabled disappears from sidebar, phone bar and More sheet', () => {
    const v = visibleNav('agent', (key) => key !== 'customers');
    const everywhere = [...v.groups.flatMap((g) => g.items), ...v.phone, ...v.moreGroups.flatMap((g) => g.items)];
    assert.ok(!everywhere.some((i) => i.pageId === 'customers'));
  });
});

describe('App shell source guarantees', () => {
  test('isPageAllowed and the role-home guard are still in App.jsx', () => {
    assert.match(appSrc, /const isPageAllowed = \(pageId\) =>/);
    assert.match(appSrc, /visibleNav\(roleKey, isPageAllowed\)/);
    assert.match(appSrc, /if \(isDelivery && page !== 'delivery'\)/);
  });

  test('no window.confirm, no fake notification bell or its fixed message', () => {
    assert.ok(!/window\.confirm\(/.test(appSrc));
    assert.ok(!appSrc.includes('All wholesale delivery routes are active'));
    assert.ok(!appSrc.includes('🔔'));
  });

  test('approval indicator is limited to Admin and Sales Manager and uses the existing endpoint', () => {
    assert.match(appSrc, /const showApprovals = Boolean\(user\) && \(isAdmin \|\| \(isManager && isPageAllowed\('orders'\)\)\)/);
    assert.match(appSrc, /api\.getPriceRequests\('pending', approvalsUserId\)/);
    assert.match(appSrc, /setApprovals\(\{ status: 'error', count: 0 \}\)/);
    // An offline cached copy is never shown as the live count
    assert.match(appSrc, /Array\.isArray\(res\.priceRequests\) && !res\.cached\)/);
    const topBar = read('shell/TopBar.jsx');
    assert.match(topBar, /badge=\{ok && count > 0/);
  });

  test('mobile preview is development-only', () => {
    assert.match(appSrc, /const DEV_PREVIEW_ENABLED = import\.meta\.env\.DEV;/);
    assert.match(appSrc, /const androidPreview = DEV_PREVIEW_ENABLED && androidPreviewState;/);
    assert.match(appSrc, /devPreview=\{DEV_PREVIEW_ENABLED \?/);
  });

  test('navigation and shell files use icons, not emoji', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const f of ['shell/navConfig.js', 'shell/SideNav.jsx', 'shell/BottomNav.jsx', 'shell/TopBar.jsx', 'shell/MoreSheet.jsx', 'shell/ProfileMenu.jsx', 'shell/AppShell.jsx']) {
      assert.ok(!emoji.test(read(f)), f);
    }
  });

  test('profile menu offers sign out only (password change not added in this phase)', () => {
    const menu = read('shell/ProfileMenu.jsx') + read('shell/MoreSheet.jsx');
    assert.ok(!/ChangePassword|changePassword|password/i.test(menu.replace(/no password change: not approved/, '')));
  });
});

describe('Android back order: overlays first, then legacy modals', () => {
  test('on the role home screen back leaves the app instead of replaying redirected history', () => {
    assert.ok(appSrc.includes('useAndroidBackButton({ enabled: Boolean(user), onBack: handleBack, isAtRoot: page === getRoleHome() });'));
  });

  test('closes the top-most registered overlay first', () => {
    const closed = [];
    const a = registerOverlay({ onRequestClose: () => closed.push('a') });
    const b = registerOverlay({ onRequestClose: () => closed.push('b') });
    assert.ok(hasOpenOverlay());
    assert.strictEqual(closeTopOverlay(), true);
    assert.deepStrictEqual(closed, ['b']);
    b();
    assert.strictEqual(closeTopOverlay(), true);
    assert.deepStrictEqual(closed, ['b', 'a']);
    a();
    assert.strictEqual(closeTopOverlay(), false);
  });

  const view = { innerWidth: 360, innerHeight: 800 };
  const btn = (text, onClick = () => {}) => ({ textContent: text, disabled: false, click: onClick });
  // kind: 'class' (.modal-overlay etc.) or 'inline' (inline position: fixed)
  const el = ({ marked = null, buttons = [], kind = 'class', rect = { width: 360, height: 800 } } = {}) => ({
    closest: () => null,
    matches: () => kind === 'class',
    getBoundingClientRect: () => rect,
    querySelector: () => marked,
    querySelectorAll: () => buttons
  });
  const docWith = (...els) => ({ defaultView: view, querySelectorAll: () => els });

  test('legacy modal with a marked close button is closed by pressing it', () => {
    let clicked = 0;
    assert.strictEqual(closeLegacyModal(docWith(el({ marked: btn('✕', () => clicked++) }))), 'closed');
    assert.strictEqual(clicked, 1);
  });
  test('legacy modal whose only close control is a ✕ glyph button is closed', () => {
    let clicked = 0;
    const modal = el({ buttons: [btn('Save price'), btn('✕', () => clicked++)] });
    assert.strictEqual(closeLegacyModal(docWith(modal)), 'closed');
    assert.strictEqual(clicked, 1);
  });
  test('text buttons such as Cancel are never pressed; back is blocked instead', () => {
    let pressed = 0;
    const modal = el({ buttons: [btn('Cancel', () => pressed++), btn('Cancel Order', () => pressed++)] });
    assert.strictEqual(closeLegacyModal(docWith(modal)), 'blocked');
    assert.strictEqual(pressed, 0);
  });
  test('an inline position:fixed full-screen overlay counts as a modal', () => {
    assert.strictEqual(closeLegacyModal(docWith(el({ kind: 'inline', buttons: [btn('Save')] }))), 'blocked');
  });
  test('a small inline fixed element (badge, bar) is not a modal', () => {
    assert.strictEqual(closeLegacyModal(docWith(el({ kind: 'inline', rect: { width: 120, height: 20 } }))), 'none');
  });
  test('no legacy modal open', () => {
    assert.strictEqual(closeLegacyModal(docWith()), 'none');
  });
});

describe('Toast variants for existing showToast(message) calls', () => {
  const cases = {
    error: [
      'Failed to update order status. Please retry.',
      'The order was not placed: the server rejected it.',
      'No internet connection. The order was not placed. Connect to the internet and try again.',
      'Error loading users',
      "Access Denied: 'summary' disabled by Administrator",
      'Your session has expired. Sign in again to place the order. The order was not placed.',
      'Mobile number 9876500001 is already registered to Demo Admin (#950).',
      'Current password is incorrect.',
      'Account is deactivated. Please contact an Administrator.',
      'Order not found.',
      'Please select a valid assigned customer store.',
      'Enter a short reason before rejecting.',
      'Please select a shop.',
      'Shop registration requires an active internet connection.'
    ],
    warning: [
      'Network drop: Status saved locally. Waiting to sync.',
      'Network error: Queued ₹50 for Onion to sync automatically.',
      'GPS coordinates updated. Please enter the street address.',
      'Backend unavailable: showing cached dashboard metrics'
    ],
    success: ['Order created successfully!', 'Welcome back, Demo Admin!', 'Visit Verified Successfully'],
    info: ['Connection interrupted. Confirming the order with the server...']
  };
  for (const [variant, messages] of Object.entries(cases)) {
    for (const m of messages) test(`${variant}: ${m}`, () => assert.strictEqual(inferToastVariant(m), variant));
  }
});

describe('Toast durations and server failure messages', () => {
  test('errors never close themselves', () => {
    assert.strictEqual(toastDuration('error', 'Failed'), null);
  });
  test('info and success stay at least 4 s and longer for long messages, at most 10 s', () => {
    assert.strictEqual(toastDuration('success', 'Saved'), 4000);
    const long = 'x'.repeat(120);
    assert.ok(toastDuration('info', long) > 4000 && toastDuration('info', long) <= 10000);
    assert.strictEqual(toastDuration('info', 'x'.repeat(1000)), 10000);
  });
  test('warnings stay at least 7 s', () => {
    assert.ok(toastDuration('warning', 'Queued') >= 7000);
  });
  test('no 4xx/5xx message sent by the server would show as success or auto-closing info', () => {
    const bad = [];
    for (const rel of ['server/index.js', 'server/visits.js']) {
      const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      for (const m of src.matchAll(/status\((4\d\d|5\d\d)\)\.json\(\{[^}]*?message:\s*(['`])((?:(?!\2).){3,200})\2/gs)) {
        const v = inferToastVariant(m[3]);
        if (v === 'success' || v === 'info') bad.push(`${m[1]} ${v}: ${m[3]}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });
});
