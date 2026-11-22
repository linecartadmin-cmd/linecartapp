/**
 * Independent, hand-reviewed list of every route that is NOT staff-only (Stage A review, M1).
 *
 * This list is deliberately written out here and never derived from server/access.js, so a route
 * that is wrongly declared public, self or account there makes the tests fail instead of quietly
 * changing what they expect. Every route not listed here must be declared 'staff'.
 * Changing this list widens access: it needs the owner's review.
 */
export const EXPECTED_NON_STAFF = Object.freeze({
  // public: no session needed
  'GET /api/ping': 'public',
  'GET /health': 'public',
  'GET /api/health': 'public',
  'GET /api/system/mode': 'public',
  'POST /api/system/setup-admin': 'public',
  'GET /api/demo-users': 'public',
  'POST /login': 'public',
  'POST /api/linecart/login': 'public',
  'POST /admin_panel/public/api/linecart/login': 'public',
  'POST /api/auth/logout': 'public',
  'GET *': 'public',
  // self: any valid session, whatever the role
  'GET /api/auth/me': 'self',
  'POST /api/auth/logout-all': 'self',
  // account: any valid session with a role in the closed role list (staff + Customer)
  'POST /api/auth/change-password': 'account'
});

/** The audience a route must have: its entry above, otherwise 'staff'. */
export function expectedAudience(key) {
  return EXPECTED_NON_STAFF[key] || 'staff';
}
