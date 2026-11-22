/**
 * Route access declarations (Phase 0, T0.1).
 *
 * Every route the server registers must be listed in ROUTE_DECLARATIONS with an audience.
 * installRouteDeclarations() wraps app.get/post/put/patch/delete/all so that:
 *   - registering an undeclared route throws, so the server refuses to start;
 *   - every route first passes an audience gate, before its own handler runs;
 *   - assertComplete() (called before listen) refuses to start if a declaration has no route.
 *
 * Audiences
 *   public   no session needed (health, sign-in, first-admin setup, the web app shell).
 *            Credentials sent to a public route are ignored.
 *   self     any valid session, whatever the role (who am I, sign out everywhere), so an account
 *            with an unsupported role can still see why and sign out.
 *   account  any valid session whose role is in ROLES (own password change).
 *   staff    any valid session whose role is one of the four staff roles.
 *   customer reserved for future customer-facing routes; no route uses it yet.
 *
 * The gate only refuses requests; it never widens access. Each handler keeps its own checks
 * (admin only, manager team, agent assignment, permissions), so staff behaviour is unchanged.
 */

export const STAFF_ROLES = Object.freeze(['Admin', 'Sales Manager', 'Field Sales Agent', 'Delivery Agent']);
// Closed role list. 'Customer' is reserved: no route admits it yet and accounts cannot be created with it.
export const ROLES = Object.freeze([...STAFF_ROLES, 'Customer']);

export const AUDIENCES = Object.freeze(['public', 'self', 'account', 'staff', 'customer']);

/** Canonical role name for a stored role (case-insensitive, trimmed); null when not in ROLES. */
export function canonicalRole(role) {
  const r = String(role || '').trim().toLowerCase();
  return ROLES.find((name) => name.toLowerCase() === r) || null;
}

export function isStaffRole(role) {
  const r = canonicalRole(role);
  return Boolean(r && STAFF_ROLES.includes(r));
}

const PUBLIC = 'public';
const SELF = 'self';
const ACCOUNT = 'account';
const STAFF = 'staff';

// Keyed "METHOD path" exactly as registered. Aliases are listed one per line on purpose.
export const ROUTE_DECLARATIONS = Object.freeze({
  // Public system and sign-in
  'GET /api/ping': PUBLIC,
  'GET /health': PUBLIC,
  'GET /api/health': PUBLIC,
  'GET /api/system/mode': PUBLIC,
  'POST /api/system/setup-admin': PUBLIC, // own Setup-token check in the handler
  'GET /api/demo-users': PUBLIC, // handler returns nothing in production
  'POST /login': PUBLIC,
  'POST /api/linecart/login': PUBLIC,
  'POST /admin_panel/public/api/linecart/login': PUBLIC,
  'POST /api/auth/logout': PUBLIC, // revokes the presented token if any; always 200 (unchanged)
  'GET *': PUBLIC, // web app shell; unknown /api/* paths answer 404

  // Session self-service
  'GET /api/auth/me': SELF,
  'POST /api/auth/logout-all': SELF,
  'POST /api/auth/change-password': ACCOUNT,

  // Staff
  'GET /users/:id': STAFF,
  'GET /api/users/:id': STAFF,
  'GET /gethomereport': STAFF,
  'GET /api/linecart/gethomereport': STAFF,
  'GET /admin_panel/public/api/linecart/gethomereport': STAFF,
  'GET /clusterinfo': STAFF,
  'GET /api/linecart/clusterinfo': STAFF,
  'GET /admin_panel/public/api/linecart/clusterinfo': STAFF,
  'POST /addcustomer': STAFF,
  'POST /api/linecart/addcustomer': STAFF,
  'POST /admin_panel/public/api/linecart/addcustomer': STAFF,
  'GET /api/uploads/shops/:filename': STAFF,
  'GET /getitemsorder': STAFF,
  'GET /api/linecart/getitemsorder': STAFF,
  'GET /admin_panel/public/api/linecart/getitemsorder': STAFF,
  'POST /createorder': STAFF,
  'POST /api/linecart/createorder': STAFF,
  'POST /admin_panel/public/api/linecart/createorder': STAFF,
  'GET /api/shops/:shopId/order-history': STAFF,
  'GET /api/linecart/shops/:shopId/order-history': STAFF,
  'PUT /api/shops/:shopId/assign': STAFF,
  'POST /api/shops/:shopId/assign-agent': STAFF,
  'POST /api/admin/shops/:shopId/assign': STAFF,
  'GET /api/shops': STAFF,
  'GET /api/role-permissions': STAFF,
  'GET /api/admin/dashboard': STAFF,
  'GET /api/admin/users': STAFF,
  'POST /api/admin/users': STAFF,
  'PUT /api/admin/users/:id': STAFF,
  'POST /api/admin/users/:id/status': STAFF,
  'DELETE /api/admin/users/:id': STAFF,
  'GET /api/admin/permissions': STAFF,
  'PUT /api/admin/permissions': STAFF,
  'GET /api/admin/orders': STAFF,
  'GET /api/delivery/orders': STAFF,
  'POST /api/delivery/orders/:id/status': STAFF,
  'GET /api/admin/reports': STAFF,
  'GET /api/admin/audit': STAFF,
  'GET /api/admin/settings': STAFF,
  'PUT /api/admin/settings': STAFF,
  'GET /api/admin/targets': STAFF,
  'POST /api/admin/targets': STAFF,
  'DELETE /api/admin/targets/:id': STAFF,
  'GET /api/items': STAFF,
  'GET /api/admin/items': STAFF,
  'POST /api/items': STAFF,
  'PUT /api/items/:id': STAFF,
  'POST /api/items/:id/archive': STAFF,
  'DELETE /api/items/:id': STAFF,
  'POST /api/items/price': STAFF,
  'GET /api/items/:id/history': STAFF,
  'GET /api/price-requests': STAFF,
  'POST /api/price-requests/:id/decision': STAFF,
  'POST /api/price-requests/:id/approve': STAFF,
  'POST /api/price-requests/:id/reject': STAFF,
  'GET /api/manager/assignments': STAFF,
  'POST /api/manager/assignments': STAFF,
  'GET /api/manager/assigned-agents': STAFF,
  'GET /api/manager/:managerId/assigned-agents': STAFF,
  'GET /api/orders/:id/visit-photo': STAFF,
  'GET /api/orders': STAFF,
  'POST /api/admin/orders': STAFF,
  'PUT /api/admin/orders/:id': STAFF,
  'POST /api/admin/orders/:id/cancel': STAFF,
  'DELETE /api/admin/orders/:id': STAFF,
  'GET /api/manager/orders': STAFF,
  'GET /api/manager/reports': STAFF,
  'GET /api/manager/targets': STAFF,
  'POST /api/manager/targets': STAFF,
  'GET /api/manager/shops': STAFF,

  // GPS visits (server/visits.js)
  'GET /api/visits/settings': STAFF,
  'GET /api/visits/my-shops': STAFF,
  'POST /api/visits/verify': STAFF,
  'GET /api/visits': STAFF,
  'GET /api/visits/summary': STAFF,
  'POST /api/visits/:id/review': STAFF,
  'GET /api/visits/shop-locations': STAFF,
  'PUT /api/shops/:shopId/location': STAFF,
  'GET /api/shops/:shopId/location-history': STAFF
});

for (const [key, audience] of Object.entries(ROUTE_DECLARATIONS)) {
  if (!AUDIENCES.includes(audience)) throw new Error(`[access] ${key} has unknown audience "${audience}"`);
}

const AUTH_MESSAGE = 'Authentication required: valid Bearer session token must be provided.';

function makeGate(audience, getCaller, authFailureCode) {
  if (audience === PUBLIC) return null;
  return function accessGate(req, res, next) {
    req._routeAudience = audience;
    const caller = getCaller(req);
    if (!caller) {
      return res.status(401).json({ status: 401, code: authFailureCode(req), message: AUTH_MESSAGE });
    }
    if (audience === SELF) return next();
    const role = canonicalRole(caller.role);
    const allowed = audience === ACCOUNT
      ? Boolean(role)
      : audience === STAFF
        ? Boolean(role && STAFF_ROLES.includes(role))
        : audience === 'customer'
          ? role === 'Customer'
          : false;
    if (!allowed) {
      return res.status(403).json({
        status: 403,
        code: 'ROLE_NOT_ALLOWED',
        message: 'Access Denied: your account role cannot use this endpoint.'
      });
    }
    return next();
  };
}

/**
 * Install the declaration check and audience gate. Must run after wrapAsyncRoutes(app) and
 * before the first route is registered.
 */
export function installRouteDeclarations(app, { getCaller, authFailureCode = () => 'AUTH_REQUIRED', declarations = ROUTE_DECLARATIONS } = {}) {
  const registered = new Map(); // key -> audience
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const previous = app[method].bind(app);
    app[method] = function declaredRoute(routePath, ...handlers) {
      // app.get('setting') reads an Express setting; it is not a route
      if (method === 'get' && handlers.length === 0 && typeof routePath === 'string') return previous(routePath);
      const paths = Array.isArray(routePath) ? routePath : [routePath];
      const audiences = new Set();
      for (const p of paths) {
        if (typeof p !== 'string') {
          throw new Error(`[access] ${method.toUpperCase()} route paths must be strings so they can be declared.`);
        }
        const key = `${method.toUpperCase()} ${p}`;
        const audience = declarations[key];
        if (!audience) {
          throw new Error(`[access] Route "${key}" has no access declaration in server/access.js. Refusing to start.`);
        }
        if (registered.has(key)) throw new Error(`[access] Route "${key}" is registered twice.`);
        registered.set(key, audience);
        audiences.add(audience);
      }
      if (audiences.size !== 1) throw new Error(`[access] Aliases ${paths.join(', ')} must share one audience.`);
      const gate = makeGate([...audiences][0], getCaller, authFailureCode);
      return gate ? previous(routePath, gate, ...handlers) : previous(routePath, ...handlers);
    };
  }
  return {
    registered,
    /** Throws when a declared route was never registered (declarations and routes must match). */
    assertComplete() {
      const missing = Object.keys(declarations).filter((key) => !registered.has(key));
      if (missing.length) {
        throw new Error(`[access] Declared routes that were never registered: ${missing.join(', ')}. Refusing to start.`);
      }
      return registered.size;
    }
  };
}
