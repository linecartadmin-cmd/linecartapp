/**
 * Full redesign (remaining staff roles): source guarantees for the shared styling layer and the
 * Field Sales Agent Today panel. Client source only; no server needed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => fs.readFileSync(path.join(repoRoot, 'client/src', rel), 'utf8');

describe('Shared styling layer for pre-redesign screens', () => {
  const bridge = src('styles/legacy-bridge.css');
  const index = src('index.css');

  test('is loaded after the legacy theme so its rules take effect', () => {
    assert.ok(index.indexOf("@import './styles/legacy-bridge.css';") > index.indexOf("@import './reference-theme.css';"));
  });

  test('is scoped to page content inside the shell and to sign-in (Delivery and primitives untouched)', () => {
    const selectors = bridge.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^{}@]+(?=\{)/gm).map((s) => s.trim()).filter(Boolean);
    for (const s of selectors) {
      if (/^(:root|html|body)/.test(s)) assert.fail(`global selector ${s}`);
      assert.ok(/\.lc-main|\.lc-login|\.lc-shell/.test(s), `scoped: ${s.slice(0, 80)}`);
      assert.ok(!/\.dl-|\.lc-btn\b|\.lc-dialog\b/.test(s), `does not restyle new components: ${s.slice(0, 80)}`);
    }
  });

  test('raises inline and Tailwind text below 12px to the 12px minimum', () => {
    for (const px of ['9px', '10px', '11px', '11.5px', '0.68rem', '0.72rem']) assert.ok(bridge.includes(`[style*="font-size: ${px}"]`), px);
    assert.ok(bridge.includes('.text-\\[10px\\], .text-\\[11px\\]'), 'Tailwind 10px/11px classes raised');
    assert.match(bridge, /font-size: var\(--lc-text-xs\) !important;/);
  });

  test('in-page back buttons stay visible (one closes the add-shop form)', () => {
    assert.ok(!/aria-label="Go back"\][^{]*\{\s*display:\s*none/.test(bridge));
    assert.match(src('components/CustomersScreen.jsx'), /onClick=\{\(\) => setViewMode\('list'\)\}/);
  });

  test('screen close controls keep the ✕ glyph Android back relies on', () => {
    for (const f of ['ItemsScreen.jsx', 'ManagerReportsScreen.jsx', 'ManagerOrdersScreen.jsx']) {
      assert.ok(src(`components/${f}`).includes('✕'), f);
    }
  });
});

describe('Field Sales Agent Today panel', () => {
  const panel = src('components/AgentTodayPanel.jsx');
  const overview = src('components/OverviewScreen.jsx');

  test('uses only existing data: visit list endpoint and the orders App.jsx already loads', () => {
    assert.match(panel, /api\.getVisitShops\('all'\)/);
    const apiCalls = [...panel.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]);
    assert.deepStrictEqual([...new Set(apiCalls)], ['getVisitShops']);
  });

  test('a figure that failed to load is shown as unavailable, never as zero', () => {
    assert.match(panel, /Unavailable/);
    assert.match(panel, /state\.status === 'ok' \? counts\?\.withoutLocation \?\? '—' : null/);
  });

  test('is shown on the agent overview with the existing order shortcut', () => {
    assert.match(overview, /<AgentTodayPanel orders=\{orders\} onNavigate=\{onNavigate\} onOrderForCustomer=\{onOrderForCustomer\} \/>/);
  });

  test('greeting follows the time of day', () => {
    assert.match(overview, /h < 12 \? 'Good morning' : h < 17 \? 'Good afternoon' : 'Good evening'/);
  });
});

describe('Approvals badge', () => {
  test('a price decision tells the shell to refresh the pending count', () => {
    const screen = src('components/ManagerOrdersScreen.jsx');
    const decision = screen.slice(screen.indexOf('api.decidePriceRequest('), screen.indexOf("showToast(res?.message || 'Failed to record decision.')"));
    assert.ok(decision.includes("new CustomEvent('linecart:price_requests_updated')"));
    assert.ok(src('App.jsx').includes("'linecart:price_requests_updated'"));
  });
});

describe('Android back on in-page forms and visit list layout', () => {
  test('back on the add-shop form returns to the shop list', () => {
    const c = src('components/CustomersScreen.jsx');
    assert.match(c, /import \{[^}]*\bregisterOverlay\b[^}]*\} from '\.\.\/ui';/);
    assert.match(c, /if \(viewMode === 'list'\) return undefined;\s*return registerOverlay\(\{ onRequestClose: \(\) => setViewMode\('list'\) \}\);/);
  });

  test('visit status pill keeps its size next to a wrapping shop name', () => {
    assert.match(src('components/VisitsScreen.jsx'), /fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', alignSelf: 'flex-start', flexShrink: 0/);
  });
});

describe("Field Sales Agent: Today's Visits at the top of My visits", () => {
  const v = src('components/VisitsScreen.jsx');

  test('uses the server count of verified visit records, not assigned or visited shops', () => {
    assert.match(v, /const value = counts\?\.verifiedVisitsToday;/);
    const card = v.slice(v.indexOf('export function TodayVisitsCount'), v.indexOf('export default function VisitsScreen'));
    assert.ok(!/visitedToday|counts\??\.all\b|shops\.length/.test(card), 'not derived from shop counts');
  });

  test('loading shows a skeleton; a failed load shows Unavailable, never zero', () => {
    assert.match(v, /\{error \? \(\s*<span className="lc-visits-today__unavailable" role="status">Unavailable<\/span>/);
    assert.match(v, /\) : loading \? \(\s*<Skeleton/);
  });

  test('is rendered first on the list view, above the heading', () => {
    const list = v.slice(v.indexOf('// ------------------------------------------------------------------ list view'));
    assert.ok(list.indexOf('<TodayVisitsCount') < list.indexOf('<h1'), 'count comes before the heading');
  });
});

describe('Manager and Admin tables on phones', () => {
  const rt = src('shell/responsiveTables.js');
  const bridge = src('styles/legacy-bridge.css');

  test('every staff screen gets the enhancer through the shell', () => {
    assert.match(src('shell/AppShell.jsx'), /useResponsiveTables\(\);/);
  });

  test('labels come from the header; complex or self-managed tables are left alone', () => {
    assert.match(rt, /const SKIP = '\.lc-table, \.dl-items, \.responsive-stack-table, \[data-lc-table="keep"\]';/);
    assert.match(rt, /th\.colSpan > 1 \|\| th\.rowSpan > 1/);
    assert.match(rt, /cells\.length !== labels\.length/);
  });

  test('cards only below 768px; tablet and desktop keep the table', () => {
    const i = bridge.indexOf('@media (max-width: 767px) {\n  .lc-main .page-content table.lc-rtable');
    assert.ok(i > 0, 'phone-only media query');
    assert.ok(!/^\s*\.lc-main \.page-content table\.lc-rtable[^{]*\{[^}]*display: block/m.test(bridge.slice(0, i)), 'no card rules outside the phone query');
  });
});

describe('Icons instead of emoji in navigation and primary actions', () => {
  const cases = {
    'AdminDashboardScreen.jsx': ['👥', '⚙️', '📜'],
    'AdminSettingsScreen.jsx': ['💾'],
    'AdminRolesPermissionsScreen.jsx': ['💾'],
    'TeamAssignmentsScreen.jsx': ['💾'],
    'ManagerReportsScreen.jsx': ['👥 Manage Team'],
    'ManagerOrdersScreen.jsx': ['📦 Team Orders', '📸'],
    'OrderEntryScreen.jsx': ['📍 Fetch GPS', '📷 {visitPhoto'],
    'ItemsScreen.jsx': ['<span>⚡</span>', "'📦 Archive'"]
  };
  for (const [file, gone] of Object.entries(cases)) {
    test(file, () => {
      const s = src(`components/${file}`);
      for (const g of gone) assert.ok(!s.includes(g), `${g} replaced`);
      assert.match(s, /import \{ Icon[^}]*\} from '\.\.\/ui';/);
    });
  }
});
