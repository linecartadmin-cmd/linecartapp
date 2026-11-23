// Pure Delivery Agent logic: no React, no network. Statuses and payment rules mirror the existing
// screen and server exactly; this module only centralises them so the UI and tests share one copy.

export const STATUS = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  PICKED_UP: 'Picked up',
  DELIVERED: 'Delivered',
  COULD_NOT_DELIVER: 'Could not deliver',
  CANCELLED: 'Cancelled',
  PRICE_PENDING: 'Price approval pending'
};

// Failure reasons sent to the server (values unchanged from the previous screen).
export const FAIL_REASONS = [
  { id: 'Shop Closed', key: 'closed' },
  { id: 'Owner Not Available', key: 'ownerUnavailable' },
  { id: 'Order Cancelled / Rejected', key: 'rejected' },
  { id: 'Wrong Address / Location Not Found', key: 'wrongAddress' }
];

const norm = (s) => String(s || '').trim().toLowerCase();

export function stopPhase(order) {
  const s = norm(order?.status);
  if (s === 'delivered') return 'delivered';
  if (s === 'could not deliver') return 'failed';
  if (s === 'cancelled' || s === 'rejected') return 'cancelled';
  if (s === 'price approval pending') return 'blocked';
  if (s === 'picked up') return 'onTheWay';
  return 'toPickUp'; // Pending, In progress, or anything new the server sends
}

export const isClosed = (order) => ['delivered', 'failed', 'cancelled'].includes(stopPhase(order));
export const isOpen = (order) => !isClosed(order);

// Same counting as before: delivered; issues = could not deliver + cancelled; the rest is pending.
export function deliveryCounts(orders = []) {
  const c = { total: orders.length, pending: 0, toPickUp: 0, onTheWay: 0, blocked: 0, delivered: 0, failed: 0 };
  for (const o of orders) {
    const p = stopPhase(o);
    if (p === 'delivered') c.delivered++;
    else if (p === 'failed' || p === 'cancelled') c.failed++;
    else {
      c.pending++;
      if (p === 'onTheWay') c.onTheWay++;
      else if (p === 'blocked') c.blocked++;
      else c.toPickUp++;
    }
  }
  c.done = c.delivered + c.failed;
  return c;
}

// Next stop in route order: the first open stop the agent can act on now. A stop waiting for price
// approval cannot be picked up, so it is skipped unless every open stop is waiting.
export function nextStopIndex(stops = []) {
  const actionable = stops.findIndex((s) => isOpen(s) && stopPhase(s) !== 'blocked');
  return actionable >= 0 ? actionable : stops.findIndex(isOpen);
}

// Payment status after delivery: identical formula to the previous screen and the server.
export function paymentOutcome(total, collected) {
  const tot = Number(total || 0);
  const col = Number(collected || 0);
  const balance = Math.max(0, tot - col);
  const status = col >= tot && tot > 0 ? 'Collected' : col > 0 ? 'Partially collected' : 'Not collected';
  return { total: tot, collected: col, balance, status };
}

// Validates the amount typed for a delivery. Returns { ok, value, error } where error is an i18n key.
export function validateCollected(raw, total) {
  if (raw === '' || raw === null || raw === undefined) return { ok: false, value: null, error: 'amountRequired' };
  const value = Number(raw);
  if (Number.isNaN(value) || value < 0) return { ok: false, value: null, error: 'amountNegative' };
  if (value > Number(total || 0)) return { ok: false, value: null, error: 'amountTooHigh' };
  return { ok: true, value: Math.round(value * 100) / 100, error: null };
}

export function orderItems(order) {
  const list = Array.isArray(order?.orderList) ? order.orderList : [];
  return list.map((it, i) => {
    const qty = Number(it.qty || 0);
    const price = Number(it.price ?? it.custprice ?? it.custPrice ?? 0);
    return {
      key: `${it.itemid ?? it.itemId ?? i}-${i}`,
      name: it.itemName || it.description || it.name || `Item ${it.itemid ?? i + 1}`,
      qty,
      unit: it.unit || (it.unitType ? String(it.unitType).replace(/s$/i, '').toLowerCase() : ''),
      price,
      lineTotal: Math.round(qty * price * 100) / 100
    };
  });
}

// Per-order sync state from the offline queue: the latest delivery mutation for the order wins.
// 'pending' (waiting or syncing), 'failed' (server refused or retries exhausted), 'synced', or null.
export function syncStateByOrder(queue = []) {
  const byOrder = new Map();
  for (const m of queue) {
    if (m?.type !== 'UPDATE_DELIVERY_STATUS' || !m.payload) continue;
    const id = String(m.payload.orderId);
    const prev = byOrder.get(id);
    if (!prev || new Date(m.createdAt) >= new Date(prev.createdAt)) byOrder.set(id, m);
  }
  const out = new Map();
  for (const [id, m] of byOrder) {
    const state = m.status === 'waiting' || m.status === 'syncing' ? 'pending' : m.status === 'failed' ? 'failed' : m.status === 'synced' ? 'synced' : null;
    out.set(id, { state, error: m.syncError || null, status: m.payload.status, at: m.createdAt });
  }
  return out;
}

export const FILTERS = ['all', 'toPickUp', 'onTheWay', 'delivered', 'failed', 'pendingSync'];

export function filterStops(stops = [], { filter = 'all', query = '', syncMap = new Map() } = {}) {
  const q = norm(query);
  return stops.filter((o) => {
    if (filter !== 'all') {
      const p = stopPhase(o);
      if (filter === 'toPickUp' && !(p === 'toPickUp' || p === 'blocked')) return false;
      if (filter === 'onTheWay' && p !== 'onTheWay') return false;
      if (filter === 'delivered' && p !== 'delivered') return false;
      if (filter === 'failed' && !(p === 'failed' || p === 'cancelled')) return false;
      if (filter === 'pendingSync') {
        const s = syncMap.get(String(o.id))?.state;
        if (s !== 'pending' && s !== 'failed') return false;
      }
    }
    if (!q) return true;
    return [o.shopName, o.ownerName, o.address, o.id, o.shopId, o.pincode].some((v) => norm(v).includes(q));
  });
}

export function hasCoords(order) {
  const lat = parseFloat(order?.latitude);
  const lng = parseFloat(order?.longitude);
  return !Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0);
}

export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
