/**
 * Delivery Agent redesign (Phase 2): pure model, strings, and source guarantees for the offline
 * queue and server-confirmed success. Client modules only; no server needed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => fs.readFileSync(path.join(repoRoot, 'client/src', rel), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(repoRoot, 'client/src', rel)).href);

const M = await load('delivery/deliveryModel.js');
const { DELIVERY_I18N } = await load('delivery/deliveryI18n.js');

const o = (status, extra = {}) => ({ id: `X-${Math.random().toString(36).slice(2, 7)}`, status, total: 1000, ...extra });

describe('Delivery statuses and counts', () => {
  test('phases follow the server status strings', () => {
    assert.strictEqual(M.stopPhase(o('Pending')), 'toPickUp');
    assert.strictEqual(M.stopPhase(o('In progress')), 'toPickUp');
    assert.strictEqual(M.stopPhase(o('Picked up')), 'onTheWay');
    assert.strictEqual(M.stopPhase(o('Delivered')), 'delivered');
    assert.strictEqual(M.stopPhase(o('Could not deliver')), 'failed');
    assert.strictEqual(M.stopPhase(o('Cancelled')), 'cancelled');
    assert.strictEqual(M.stopPhase(o('Price approval pending')), 'blocked');
  });

  test('counts match the previous screen: delivered; issues = could not deliver + cancelled; rest pending', () => {
    const c = M.deliveryCounts([o('In progress'), o('Picked up'), o('Delivered'), o('Could not deliver'), o('Cancelled'), o('Price approval pending')]);
    assert.deepStrictEqual(
      { total: c.total, pending: c.pending, delivered: c.delivered, failed: c.failed, done: c.done },
      { total: 6, pending: 3, delivered: 1, failed: 2, done: 3 }
    );
  });

  test('next stop is the first actionable open stop; price-pending stops are skipped unless nothing else is open', () => {
    assert.strictEqual(M.nextStopIndex([o('Delivered'), o('Price approval pending'), o('In progress')]), 2);
    assert.strictEqual(M.nextStopIndex([o('Delivered'), o('Price approval pending')]), 1);
    assert.strictEqual(M.nextStopIndex([o('Delivered'), o('Could not deliver')]), -1);
  });
});

describe('Payment rules', () => {
  // Same formula as offlineDb.updateLocalDeliveryOrderStatus and the server
  const reference = (total, col) => (col >= total && total > 0 ? 'Collected' : col > 0 ? 'Partially collected' : 'Not collected');
  for (const [total, col] of [[1000, 1000], [1000, 400], [1000, 0], [928.5, 928.5], [0, 0]]) {
    test(`total ${total}, collected ${col}`, () => {
      const p = M.paymentOutcome(total, col);
      assert.strictEqual(p.status, reference(total, col));
      assert.strictEqual(p.balance, Math.max(0, total - col));
    });
  }
  test('amount validation: required, not negative, not above total', () => {
    assert.strictEqual(M.validateCollected('', 100).error, 'amountRequired');
    assert.strictEqual(M.validateCollected('-1', 100).error, 'amountNegative');
    assert.strictEqual(M.validateCollected('abc', 100).error, 'amountNegative');
    assert.strictEqual(M.validateCollected('100.01', 100).error, 'amountTooHigh');
    assert.deepStrictEqual(M.validateCollected('40.5', 100), { ok: true, value: 40.5, error: null });
    for (const key of ['amountRequired', 'amountNegative', 'amountTooHigh']) {
      assert.ok(DELIVERY_I18N.en[key] && DELIVERY_I18N.ta[key], `message ${key} exists in both languages`);
    }
  });
});

describe('Sync state per stop (from the offline queue)', () => {
  const m = (orderId, status, createdAt, syncError = null) => ({ type: 'UPDATE_DELIVERY_STATUS', status, createdAt, syncError, payload: { orderId, status: 'Delivered' } });
  test('latest mutation for an order wins; waiting/syncing = pending, failed keeps the server message', () => {
    const map = M.syncStateByOrder([
      m('A', 'synced', '2026-11-23T08:00:00Z'),
      m('A', 'waiting', '2026-11-23T09:00:00Z'),
      m('B', 'failed', '2026-11-23T09:00:00Z', 'already finalized'),
      m('C', 'syncing', '2026-11-23T09:00:00Z'),
      { type: 'UPDATE_ITEM_PRICE', status: 'failed', createdAt: '2026-11-23T09:00:00Z', payload: { orderId: 'D' } }
    ]);
    assert.strictEqual(map.get('A').state, 'pending');
    assert.deepStrictEqual([map.get('B').state, map.get('B').error], ['failed', 'already finalized']);
    assert.strictEqual(map.get('C').state, 'pending');
    assert.ok(!map.has('D'), 'price updates are not delivery sync states');
  });
});

describe('Search and filters', () => {
  const stops = [
    o('In progress', { shopName: 'Green Valley Mart', address: 'Bazaar Street' }),
    o('Picked up', { shopName: 'அண்ணாமலை காய்கறி கடை', address: 'காந்தி சாலை' }),
    o('Delivered', { shopName: 'Sunrise Fresh Produce' }),
    o('Could not deliver', { shopName: 'Sri Murugan Vegetables and Fruits Wholesale Commission Agency' }),
    o('Price approval pending', { shopName: 'Blocked Shop' })
  ];
  test('filters by phase, including price-pending under "to pick up"', () => {
    const names = (f) => M.filterStops(stops, { filter: f }).map((s) => s.shopName);
    assert.deepStrictEqual(names('toPickUp'), ['Green Valley Mart', 'Blocked Shop']);
    assert.deepStrictEqual(names('onTheWay'), ['அண்ணாமலை காய்கறி கடை']);
    assert.deepStrictEqual(names('delivered'), ['Sunrise Fresh Produce']);
    assert.strictEqual(names('failed').length, 1);
  });
  test('search matches English and Tamil text, case-insensitive', () => {
    assert.strictEqual(M.filterStops(stops, { query: 'அண்ணா' }).length, 1);
    assert.strictEqual(M.filterStops(stops, { query: 'commission AGENCY' }).length, 1);
    assert.strictEqual(M.filterStops(stops, { query: 'nothing-like-this' }).length, 0);
  });
  test('"not synced" filter uses the queue state', () => {
    const syncMap = new Map([[String(stops[0].id), { state: 'failed' }], [String(stops[2].id), { state: 'synced' }]]);
    assert.deepStrictEqual(M.filterStops(stops, { filter: 'pendingSync', syncMap }).map((s) => s.shopName), ['Green Valley Mart']);
  });
  test('order items are read from orderList with line totals', () => {
    const items = M.orderItems({ orderList: [{ itemid: 1, itemName: 'Onion', qty: 10, price: 53, unitType: 'Kgs' }] });
    assert.deepStrictEqual(items.map((i) => [i.name, i.qty, i.unit, i.lineTotal]), [['Onion', 10, 'kg', 530]]);
  });
});

describe('Strings', () => {
  test('English and Tamil have exactly the same keys', () => {
    const keys = (obj, pre = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
    assert.deepStrictEqual(keys(DELIVERY_I18N.ta).sort(), keys(DELIVERY_I18N.en).sort());
  });
  test('failure reasons sent to the server are unchanged', () => {
    assert.deepStrictEqual(M.FAIL_REASONS.map((r) => r.id), ['Shop Closed', 'Owner Not Available', 'Order Cancelled / Rejected', 'Wrong Address / Location Not Found']);
    for (const r of M.FAIL_REASONS) assert.ok(DELIVERY_I18N.en.reasons[r.key] && DELIVERY_I18N.ta.reasons[r.key]);
  });
});

describe('Offline queue and server confirmation (source guarantees)', () => {
  const hook = src('delivery/useDeliveryRoute.js');
  const screen = src('components/DeliveryRouteScreen.jsx');

  test('offline: queue first, then the local cache update (same order as before)', () => {
    const q = hook.indexOf('await queueDeliveryStatusUpdate(userId, orderId, newStatus, reason, note, paymentAmountCollected, paymentNotes, expectedStatus)');
    const l = hook.indexOf('await updateLocalDeliveryOrderStatus(userId, orderId, newStatus, reason, note, paymentAmountCollected, paymentNotes)');
    assert.ok(q > 0 && l > q);
    assert.match(hook, /typeof navigator !== 'undefined' && !navigator\.onLine/);
  });

  test('online call keeps the existing API signature; a network drop falls back to the queue', () => {
    // Same positional arguments as before; expectedStatus is appended (older servers ignore it)
    assert.match(hook, /api\.updateDeliveryStatus\(orderId, newStatus, reason, note, null, null, paymentAmountCollected, paymentNotes, expectedStatus\)/);
    assert.match(hook, /\} catch \{\s*\/\/ Network dropped mid-request[\s\S]{0,120}queueIt/);
  });

  test('only a server-accepted update reports "synced"; rejection changes nothing locally', () => {
    assert.match(hook, /if \(res && \(res\.status === 200 \|\| res\.status === 1\)\) \{[\s\S]*?return \{ outcome: 'synced'/);
    assert.match(hook, /return \{ outcome: 'rejected', message: res\?\.message, serverStatus: res\?\.currentStatus \|\| null \}/);
    assert.match(screen, /title=\{result\?\.outcome === 'synced' \? t\.deliveredSaved : t\.deliveredQueued\}/);
  });

  test('double taps cannot send the same update twice', () => {
    assert.match(hook, /if \(inFlight\.current\) return \{ outcome: 'busy' \};/);
    assert.match(hook, /finally \{\s*inFlight\.current = false;/);
  });

  test('price-approval-pending orders are blocked before any request', () => {
    assert.match(hook, /target\.status === STATUS\.PRICE_PENDING\) \{[\s\S]{0,160}return \{ outcome: 'rejected' \}/);
  });

  test('queue retry semantics are untouched (sync engine not modified by the delivery screen)', () => {
    assert.ok(!/triggerSync|updateMutation|discardQueueEntry/.test(hook + screen));
  });

  test('the screen no longer duplicates the shell header, sign-out or preview switch', () => {
    assert.ok(!/SyncStatusBar|onLogout\(|onTogglePreview|Laptop view/.test(screen));
  });
});

describe('Emulator walkthrough fixes (Phase 2)', () => {
  const screen = src('components/DeliveryRouteScreen.jsx');
  const app = src('App.jsx');
  const toast = src('ui/Toast.jsx');

  test('Android back on "All stops" or "Map" returns to "Today" before leaving the app', () => {
    assert.match(screen, /if \(view === 'today'\) return undefined;\s*return registerOverlay\(\{ onRequestClose: \(\) => setView\('today'\) \}\);/);
  });

  test('stale error toasts from failed sign-in attempts are cleared once sign-in succeeds', () => {
    assert.match(toast, /const clearErrors = useCallback\(\(\) => \{\s*setToasts\(\(list\) => list\.filter\(\(x\) => x\.variant !== 'error'\)\);/);
    assert.match(app, /onLoginSuccess=\{\(u\) => \{[\s\S]{0,160}toastApi\.clearErrors\(\);/);
  });

  test('navigate button keeps a short visible label; the address-only meaning stays in its accessible name', () => {
    assert.match(screen, /<span>\{t\.navigate\}<\/span>/);
    assert.match(screen, /aria-label=\{hasCoords\(stop\) \? t\.navigate : t\.openMapByAddress\}/);
  });
});

describe('Server refusals (409) on the device', () => {
  test('queue: 409 marks the update failed (never synced), keeps the server status and the code', async () => {
    const { classifyDeliverySyncResponse } = await load('offline/deliverySyncResult.js');
    const r = classifyDeliverySyncResponse({ status: 409, code: 'STATUS_CONFLICT', currentStatus: 'Cancelled', requestedStatus: 'Picked up', message: 'Order was cancelled and cannot be changed to \'Picked up\'.' });
    assert.deepStrictEqual(
      [r.outcome, r.isConflict, r.serverStatus, r.requestedStatus, r.code],
      ['failed', true, 'Cancelled', 'Picked up', 'STATUS_CONFLICT']
    );
    assert.match(r.error, /cancelled/);
    assert.strictEqual(classifyDeliverySyncResponse({ status: 200, idempotentReplay: true }).outcome, 'synced');
    assert.strictEqual(classifyDeliverySyncResponse({ status: 400, message: 'bad' }).outcome, 'failed');
    assert.strictEqual(classifyDeliverySyncResponse(null).outcome, 'failed');
  });

  test('queue replays send expectedStatus when it was recorded; older queued items still work without it', () => {
    const engine = src('offline/syncEngine.js');
    assert.match(engine, /\.\.\.\(expectedStatus \? \{ expectedStatus \} : \{\}\)/);
    assert.match(engine, /paymentNotes,\s*expectedStatus \|\| null\s*\);/);
    assert.match(engine, /const result = classifyDeliverySyncResponse\(res\);/);
  });

  test('a refused queued update replaces the local change with the server status on the device', () => {
    const engine = src('offline/syncEngine.js');
    const hook = src('delivery/useDeliveryRoute.js');
    assert.match(engine, /if \(result\.isConflict && result\.serverStatus\) \{[\s\S]{0,200}applyServerDeliveryStatus\(userId, orderId, result\.serverStatus\)/);
    assert.match(engine, /'linecart:delivery_conflict'/);
    assert.match(hook, /'linecart:delivery_conflict'/);
    assert.match(hook, /if \(res && res\.status === 409 && res\.currentStatus\) \{[\s\S]{0,200}applyLocal\(orderId, \{ status: res\.currentStatus, syncState: 'rejected' \}\)/);
    const db = src('offline/offlineDb.js');
    const fn = db.slice(db.indexOf('export async function applyServerDeliveryStatus'), db.indexOf('export async function updateLocalDeliveryOrderStatus'));
    assert.ok(fn.length > 0 && !/payment/i.test(fn.replace(/payment fields are left as they are/, '')), 'only the status is changed, payment untouched');
  });

  test('"Could not deliver" is offered only after pick-up', () => {
    const screen = src('components/DeliveryRouteScreen.jsx');
    assert.match(screen, /\{p === 'onTheWay' \? \(\s*<Button variant="danger-ghost" block icon=\{XCircle\}/);
  });
});
