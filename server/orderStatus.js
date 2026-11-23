// Order status lifecycle: one place for the transition rules and the atomic status write.
//
// Owner decisions (23 Nov 2026):
//  - Cancelled, Delivered and Could not deliver are closed. Nothing moves an order out of them
//    through the ordinary endpoints (an explicit, audited admin reopen action does not exist yet).
//  - Delivery Agents: awaiting pick-up -> Picked up -> Delivered | Could not deliver. No moves back.
//  - Could not deliver requires Picked up (all roles).
//  - Ordinary cancellation only before pick-up (Pending, In progress, Price approval pending).
//  - Admin edits accept only recognised statuses and the transitions below.
//  - Payment records are never touched by these rules.

export const ORDER_STATUSES = Object.freeze([
  'Pending',
  'In progress',
  'Price approval pending',
  'Picked up',
  'Delivered',
  'Could not deliver',
  'Cancelled'
]);

export const CLOSED_STATUSES = Object.freeze(['Delivered', 'Could not deliver', 'Cancelled']);
const AWAITING_PICKUP = ['Pending', 'In progress'];
export const CANCELLABLE_STATUSES = Object.freeze(['Pending', 'In progress', 'Price approval pending']);

// Allowed target statuses per current status.
const AGENT_TRANSITIONS = {
  Pending: ['Picked up'],
  'In progress': ['Picked up'],
  'Picked up': ['Delivered', 'Could not deliver']
};
const ADMIN_TRANSITIONS = {
  Pending: ['In progress', 'Picked up', 'Delivered', 'Cancelled'],
  'In progress': ['Pending', 'Picked up', 'Delivered', 'Cancelled'],
  'Price approval pending': ['Cancelled'], // leaves this state through the price decision
  'Picked up': ['Delivered', 'Could not deliver']
};

// Orders saved without a status are treated as 'In progress' everywhere in the app.
export const effectiveStatus = (status) => (status === null || status === undefined || status === '' ? 'In progress' : String(status));

export const isRecognisedStatus = (status) => ORDER_STATUSES.includes(status);

// Pending and In progress both mean "awaiting pick-up" for stale-update detection.
export function sameLifecycleState(a, b) {
  if (a === b) return true;
  return AWAITING_PICKUP.includes(a) && AWAITING_PICKUP.includes(b);
}

/**
 * Checks one transition. Returns { ok: true } or { ok: false, message }.
 * actor: 'agent' (Delivery Agent) or 'admin'.
 */
export function checkTransition(from, to, actor) {
  const current = effectiveStatus(from);
  if (current === to) return { ok: true };
  if (CLOSED_STATUSES.includes(current)) {
    const what = current === 'Cancelled' ? 'was cancelled' : `is already closed as '${current}'`;
    return { ok: false, message: `Order ${what} and cannot be changed to '${to}'.` };
  }
  if (to === 'Could not deliver' && current !== 'Picked up') {
    return { ok: false, message: `'Could not deliver' is only possible after the order has been picked up (current status '${current}').` };
  }
  if (to === 'Cancelled' && !CANCELLABLE_STATUSES.includes(current)) {
    return { ok: false, message: `Order cannot be cancelled after pick-up (current status '${current}').` };
  }
  const table = actor === 'admin' ? ADMIN_TRANSITIONS : AGENT_TRANSITIONS;
  const allowed = table[current] || [];
  if (!allowed.includes(to)) {
    if (actor !== 'admin' && current === 'Picked up' && AWAITING_PICKUP.includes(to)) {
      return { ok: false, message: `A picked-up order cannot be moved back to '${to}'.` };
    }
    if (actor !== 'admin' && AWAITING_PICKUP.includes(current) && to === 'Delivered') {
      return { ok: false, message: `Order must be marked as 'Picked up' before it can be marked as 'Delivered'.` };
    }
    return { ok: false, message: `Changing an order from '${current}' to '${to}' is not allowed.` };
  }
  return { ok: true };
}

export function conflictBody({ code = 'STATUS_CONFLICT', orderId, currentStatus, requestedStatus, message }) {
  return {
    status: 409,
    code,
    orderId,
    currentStatus,
    requestedStatus,
    message: message || `Order '${orderId}' is '${currentStatus}' and cannot be changed to '${requestedStatus}'.`
  };
}

/**
 * Atomic status write (compare-and-set): the UPDATE applies only while the order still has the
 * status the caller checked. Works on PostgreSQL and SQLite with no schema change.
 *   setSql: the SET clause with $1..$n placeholders; params: its values.
 * Returns { applied: true } or { applied: false, currentStatus } (re-read from the database).
 */
export async function updateOrderIfStatus(q, orderId, expectedFrom, setSql, params) {
  const n = params.length;
  const res = await q.query(
    `UPDATE orders SET ${setSql} WHERE order_id = $${n + 1} AND COALESCE(status, 'In progress') = $${n + 2}`,
    [...params, orderId, effectiveStatus(expectedFrom)]
  );
  if (res.rowCount > 0) return { applied: true };
  const now = await q.query('SELECT status FROM orders WHERE order_id = $1', [orderId]);
  return { applied: false, currentStatus: now.rows.length ? effectiveStatus(now.rows[0].status) : null };
}
