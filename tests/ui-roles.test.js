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
    for (const px of ['9px', '10px', '11px', '11.5px']) assert.ok(bridge.includes(`[style*="font-size: ${px}"]`), px);
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
