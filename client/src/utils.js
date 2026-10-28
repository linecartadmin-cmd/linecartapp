/**
 * Formats a shop ID into a stable, unique short ID with prefix 'S'
 * Matches the required format, e.g. shop ID 33 -> 'S033', shop ID 345 -> 'S345'
 */
export function formatShopId(id) {
  if (id === undefined || id === null || id === '') return 'S000';
  if (typeof id === 'string' && /^S\d+$/i.test(id)) {
    const num = parseInt(id.slice(1), 10);
    return `S${String(num).padStart(3, '0')}`;
  }
  const num = parseInt(id, 10);
  if (isNaN(num)) return `S${id}`;
  return `S${String(num).padStart(3, '0')}`;
}

/**
 * Generates a Google Maps URL for a shop.
 * Uses latitude and longitude if available.
 * If coordinates are missing, falls back to the shop's address as the search query.
 * Returns null if neither coordinates nor address is available.
 */
export function getGoogleMapsUrl(shop) {
  if (!shop) return null;
  const lat = parseFloat(shop.latitude);
  const lng = parseFloat(shop.longitude);
  const hasCoords = !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);

  if (hasCoords) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  const addr = (shop.address || '').trim();
  if (addr) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  }

  return null;
}

/**
 * Computes payment collection breakdown and formatted display text for an order.
 * Keeps delivery completion separate from payment status.
 *
 * Statuses: 'Collected' | 'Partially collected' | 'Not collected'
 * Examples:
 *   - Delivered · Collected ₹500 of ₹500 · Balance ₹0
 *   - Delivered · Partially collected ₹200 of ₹500 · Balance ₹300
 *   - Delivered · Not collected · Balance ₹500
 */
export function getPaymentSummary(order) {
  if (!order) {
    return {
      deliveryStatus: 'Pending',
      paymentStatus: 'Not collected',
      total: 0,
      collected: 0,
      balance: 0,
      summaryText: 'Not collected · Balance ₹0',
      fullText: 'Pending · Not collected · Balance ₹0',
      statusClass: 'unpaid'
    };
  }

  const total = Number(order.total || 0);
  const collected = Number(order.paymentAmountCollected ?? order.payment_amount_collected ?? 0);
  const balance = order.paymentBalanceDue !== undefined && order.paymentBalanceDue !== null
    ? Number(order.paymentBalanceDue)
    : Math.max(0, total - collected);

  let paymentStatus = order.paymentStatus || order.payment_status;
  if (!paymentStatus) {
    if (collected >= total && total > 0) {
      paymentStatus = 'Collected';
    } else if (collected > 0) {
      paymentStatus = 'Partially collected';
    } else {
      paymentStatus = 'Not collected';
    }
  }

  let summaryText = '';
  let statusClass = 'unpaid';
  if (paymentStatus === 'Collected') {
    summaryText = `Collected ₹${collected.toLocaleString('en-IN')} of ₹${total.toLocaleString('en-IN')} · Balance ₹${balance.toLocaleString('en-IN')}`;
    statusClass = 'paid';
  } else if (paymentStatus === 'Partially collected') {
    summaryText = `Partially collected ₹${collected.toLocaleString('en-IN')} of ₹${total.toLocaleString('en-IN')} · Balance ₹${balance.toLocaleString('en-IN')}`;
    statusClass = 'partial';
  } else {
    summaryText = `Not collected · Balance ₹${balance.toLocaleString('en-IN')}`;
    statusClass = 'unpaid';
  }

  const deliveryStatus = order.status || 'In progress';
  const fullText = `${deliveryStatus} · ${summaryText}`;

  return {
    deliveryStatus,
    paymentStatus,
    total,
    collected,
    balance,
    summaryText,
    fullText,
    statusClass,
    collectedAt: order.paymentCollectedAt || order.payment_collected_at || null,
    collectedBy: order.paymentCollectedByName || order.payment_collected_by_name || null
  };
}
