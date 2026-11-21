/**
 * Device cache of the signed-in user's order list (localStorage key 'linecart_orders').
 *
 * Rules:
 * - Never store visit photos (base64 images): they quickly exceed the ~5 MB localStorage quota and
 *   a failed write used to crash the app.
 * - Every write is guarded: a full quota trims the list, and a remaining failure is ignored.
 * - The cache belongs to one user. It is ignored for any other user and removed on sign-out.
 */
export const ORDERS_KEY = 'linecart_orders';
export const ORDERS_OWNER_KEY = 'linecart_orders_owner';
const MAX_CACHED_ORDERS = 500;

function stripHeavyFields(order) {
  if (!order || typeof order !== 'object') return order;
  const { visitPhoto, ...rest } = order;
  return { ...rest, visitPhoto: null, hasVisitPhoto: Boolean(order.hasVisitPhoto || visitPhoto) };
}

export function saveOrdersCache(orders, userId) {
  if (!Array.isArray(orders)) return false;
  const slim = orders.map(stripHeavyFields);
  const attempts = [slim, slim.slice(0, MAX_CACHED_ORDERS), slim.slice(0, 100)];
  for (const list of attempts) {
    try {
      localStorage.setItem(ORDERS_KEY, JSON.stringify(list));
      if (userId !== undefined && userId !== null) localStorage.setItem(ORDERS_OWNER_KEY, String(userId));
      return true;
    } catch {
      // quota exceeded or storage unavailable: try a smaller list
    }
  }
  try {
    localStorage.removeItem(ORDERS_KEY);
  } catch {}
  return false;
}

export function loadOrdersCache(userId) {
  try {
    const owner = localStorage.getItem(ORDERS_OWNER_KEY);
    if (userId !== undefined && userId !== null && owner && owner !== String(userId)) return [];
    const raw = localStorage.getItem(ORDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(stripHeavyFields) : [];
  } catch {
    return [];
  }
}

export function clearOrdersCache() {
  try {
    localStorage.removeItem(ORDERS_KEY);
    localStorage.removeItem(ORDERS_OWNER_KEY);
  } catch {}
}
