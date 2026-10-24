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
