/**
 * Turns a declared route (method + Express path) into a concrete probe request that can never
 * touch a real record: path ids are ids that do not exist, bodies are empty objects.
 */
const PARAM_VALUES = {
  id: '999999',
  shopId: '999999',
  managerId: '100',
  filename: 'shop_999999_0a1b2c3d.jpg'
};

export function concretePath(routePath) {
  if (routePath === '*') return '/__sweep/spa-page';
  return routePath.replace(/:([A-Za-z]+)/g, (_, name) => PARAM_VALUES[name] || '999999');
}

// Probes that end the caller's session run after everything else, in this order
export const SESSION_ENDING = ['POST /api/auth/logout-all', 'POST /api/auth/logout'];

export const SWEEP_IDENTITIES = ['none', 'customer', 'auditor', 'delivery', 'agent', 'manager', 'admin'];

export async function probe(base, method, routePath, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + concretePath(routePath), {
    method,
    headers,
    body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
    redirect: 'manual'
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, code: json && typeof json === 'object' ? json.code ?? null : null };
}

/** Runs every probe for every identity; returns { "identity METHOD path": status }. */
export async function sweep(base, tokens, routes) {
  const keyOf = (r) => `${r.method} ${r.path}`;
  const ordered = [...routes.filter((r) => !SESSION_ENDING.includes(keyOf(r))),
                   ...SESSION_ENDING.flatMap((k) => routes.filter((r) => keyOf(r) === k))];
  const out = {};
  for (const who of SWEEP_IDENTITIES) {
    const token = who === 'none' ? null : tokens[who];
    for (const r of ordered) {
      out[`${who} ${r.method} ${r.path}`] = (await probe(base, r.method, r.path, token)).status;
    }
  }
  return out;
}
