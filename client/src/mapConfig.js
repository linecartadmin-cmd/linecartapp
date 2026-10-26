/**
 * LineCart Map Tile Configuration Provider
 * 
 * Configures legitimate, policy-compliant map tile sources for LineCart maps.
 * 
 * Supports environment overrides via:
 * - VITE_MAP_TILE_URL: Custom XYZ tile URL template (e.g. CARTO, MapTiler, Stadia, self-hosted)
 * - VITE_MAP_TILE_KEY: Public client map key (treated as a public credential, with domain/app restrictions)
 * - VITE_MAP_TILE_ATTRIBUTION: HTML attribution string for the tile provider
 * - VITE_MAP_TILE_SUBDOMAINS: Subdomains for tile rotation (default 'abc')
 * 
 * Tile Providers:
 * 1. OpenStreetMap Standard (Default when no commercial key is configured):
 *    - Displays actual street tiles out of the box without requiring registration or an API key.
 *    - Uses element-level referrerPolicy ('strict-origin-when-cross-origin') to comply with OSM tile policy.
 * 
 * 2. CARTO Voyager (When VITE_MAP_TILE_KEY is configured):
 *    - Commercial global CDN distribution built on OpenStreetMap data.
 *    - Strictly requires an API key (requests without a key return an "API KEY REQUIRED" watermark tile).
 *    - Free commercial tier (up to 1M req/mo) and non-commercial tier (up to 5M req/mo) via https://carto.com/basemaps/apikey.
 */

export const OSM_STANDARD_CONFIG = {
  id: 'osm-standard',
  name: 'OpenStreetMap Standard',
  requiresKey: false,
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  subdomains: 'abc',
  maxZoom: 19
};

export const CARTO_VOYAGER_CONFIG = {
  id: 'carto-voyager',
  name: 'CARTO Voyager',
  requiresKey: true,
  urlTemplate: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
  subdomains: 'abc',
  maxZoom: 19
};

export const DEFAULT_TILE_CONFIG = OSM_STANDARD_CONFIG;

/**
 * Resolve the active map tile configuration from environment or defaults.
 */
export function getMapTileConfig() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' ? process.env : {});
  const envUrl = (env?.VITE_MAP_TILE_URL || '').trim();
  const envKey = (env?.VITE_MAP_TILE_KEY || '').trim();
  const envAttr = (env?.VITE_MAP_TILE_ATTRIBUTION || '').trim();
  const envSub = (env?.VITE_MAP_TILE_SUBDOMAINS || '').trim();

  // 1. If explicit tile URL is provided in environment
  if (envUrl) {
    let resolvedUrl = envUrl;

    if (envKey) {
      if (resolvedUrl.includes('{key}')) {
        resolvedUrl = resolvedUrl.replace('{key}', encodeURIComponent(envKey));
      } else if (resolvedUrl.includes('?')) {
        resolvedUrl += `&key=${encodeURIComponent(envKey)}`;
      } else {
        resolvedUrl += `?key=${encodeURIComponent(envKey)}`;
      }
    } else if (resolvedUrl.includes('cartocdn.com')) {
      console.warn(
        '[MapConfig] Warning: CARTO basemaps strictly require a public API key (https://carto.com/basemaps/apikey). ' +
        'Requests without a key display an "API KEY REQUIRED" watermark. Configure VITE_MAP_TILE_KEY in .env.'
      );
    }

    const defaultAttr = envUrl.includes('cartocdn.com')
      ? CARTO_VOYAGER_CONFIG.attribution
      : OSM_STANDARD_CONFIG.attribution;

    return {
      providerId: 'custom',
      url: resolvedUrl,
      attribution: envAttr || defaultAttr,
      subdomains: envSub || 'abc',
      maxZoom: 19,
      hasKey: Boolean(envKey)
    };
  }

  // 2. If a public map key is configured, use authenticated CARTO Voyager
  if (envKey) {
    const cartoUrl = `${CARTO_VOYAGER_CONFIG.urlTemplate}?key=${encodeURIComponent(envKey)}`;
    return {
      providerId: 'carto-voyager',
      url: cartoUrl,
      attribution: envAttr || CARTO_VOYAGER_CONFIG.attribution,
      subdomains: envSub || CARTO_VOYAGER_CONFIG.subdomains,
      maxZoom: CARTO_VOYAGER_CONFIG.maxZoom,
      hasKey: true
    };
  }

  // 3. Keyless default: OpenStreetMap standard tiles (serves authentic street tiles without watermarks)
  return {
    providerId: 'osm-standard',
    url: OSM_STANDARD_CONFIG.url,
    attribution: envAttr || OSM_STANDARD_CONFIG.attribution,
    subdomains: envSub || OSM_STANDARD_CONFIG.subdomains,
    maxZoom: OSM_STANDARD_CONFIG.maxZoom,
    hasKey: false
  };
}

/**
 * Create a Leaflet tile layer adhering to tile provider policies,
 * with element-scoped referrerPolicy, standard browser caching, and robust fallback.
 * 
 * @param {object} [leafletInstance] - Leaflet library instance (defaults to window.L if available)
 */
export function createMapTileLayer(leafletInstance) {
  const Leaflet = leafletInstance || (typeof window !== 'undefined' ? window.L : null);
  if (!Leaflet || typeof Leaflet.tileLayer !== 'function') {
    throw new Error('Leaflet instance with tileLayer support must be provided to createMapTileLayer.');
  }

  const config = getMapTileConfig();

  const layer = Leaflet.tileLayer(config.url, {
    maxZoom: config.maxZoom,
    subdomains: config.subdomains,
    attribution: config.attribution,
    // Element-scoped referrer policy: sends application origin to the tile provider
    // for API key domain verification and provider policy compliance, without weakening
    // the document's global strict 'no-referrer' privacy setting.
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOrigin: true
  });

  // Fallback to secondary provider if network failure occurs
  layer.on('tileerror', (error) => {
    if (error && error.tile && error.coords) {
      const { x, y, z } = error.coords;
      if (config.providerId !== 'osm-standard') {
        error.tile.src = `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`;
      }
    }
  });

  return layer;
}
