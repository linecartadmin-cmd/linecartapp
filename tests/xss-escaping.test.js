/**
 * PR-6: data from shops and orders is escaped wherever HTML is built as a string (Leaflet maps).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, safeTel } from '../client/src/utils.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('escapeHtml', () => {
  test('escapes every HTML-significant character', () => {
    assert.strictEqual(
      escapeHtml(`"><img src=x onerror='alert(1)'>` + '`&'),
      '&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&#96;&amp;'
    );
  });
  test('handles null, undefined and numbers', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
    assert.strictEqual(escapeHtml(42), '42');
  });
});

describe('safeTel', () => {
  test('keeps digits and a leading plus only', () => {
    assert.strictEqual(safeTel('+91 98765-43210'), '+919876543210');
    assert.strictEqual(safeTel('98765 43219'), '9876543219');
  });
  test('drops values that are not phone numbers', () => {
    assert.strictEqual(safeTel('javascript:alert(1)'), '');
    assert.strictEqual(safeTel('" onclick="x'), '');
  });
});

describe('Map screens', () => {
  const userFields = ['shopName', 'ownerName', 'address', 'contact1', 'contactPhone', 'shopCategory', 'status'];
  for (const file of ['ShopMapScreen.jsx', 'DeliveryRouteScreen.jsx', 'DeliveryRouteMap.jsx']) {
    test(`${file}: no raw shop/order text inside HTML template strings`, () => {
      const lines = fs.readFileSync(path.join(repoRoot, 'client/src/components', file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/<[a-z]/.test(line) || line.includes('className=')) return; // only string-built HTML, not JSX
        for (const m of line.matchAll(/\$\{([^}]*)\}/g)) {
          const expr = m[1].trim();
          const usesField = userFields.some((f) => new RegExp(`\\.${f}\\b`).test(expr));
          // getStatusColor/getStatusIcon map a status to a fixed constant and never echo their input
          const wrappedOrConditional = /^(escapeHtml|safeTel|Number|getStatusColor|getStatusIcon)\(/.test(expr) || /\?\s*$/.test(expr) || expr.endsWith('?') || /\?\s*`/.test(expr) || /^[\w.]+ \?/.test(expr);
          if (usesField && !wrappedOrConditional) {
            assert.fail(`${file}:${i + 1} interpolates \${${expr}} without escapeHtml`);
          }
        }
      });
    });
  }
});
