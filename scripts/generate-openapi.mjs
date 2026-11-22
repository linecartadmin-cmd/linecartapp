/**
 * Builds the OpenAPI description of the LineCart API from server/access.js (Phase 0, T0.18).
 *
 *   node scripts/generate-openapi.mjs          writes docs/openapi.json
 *   node scripts/generate-openapi.mjs --check  exits 1 if docs/openapi.json is out of date
 *
 * The route list, audiences and auth responses come from the route declarations, so the
 * description cannot drift from the server: tests/api-contract.test.js runs the check.
 * Request and response bodies beyond the shared fields are not described yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROUTE_DECLARATIONS, ROLES, STAFF_ROLES } from '../server/access.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OPENAPI_PATH = path.join(repoRoot, 'docs', 'openapi.json');

export const AUTH_401_CODES = ['AUTH_REQUIRED', 'AUTH_MALFORMED', 'AUTH_CONFLICT', 'SESSION_INVALID', 'SESSION_EXPIRED'];
export const AUTH_403_CODES = ['ROLE_NOT_ALLOWED', 'FORBIDDEN'];

// Paths kept for installed apps and the legacy admin panel (never removed or renamed)
export function isLegacyAlias(routePath) {
  return routePath.startsWith('/admin_panel/') || routePath.startsWith('/api/linecart/') ||
    ['/login', '/gethomereport', '/clusterinfo', '/addcustomer', '/getitemsorder', '/createorder', '/health'].includes(routePath) ||
    routePath.startsWith('/users/');
}

const AUDIENCE_TEXT = {
  public: 'No session needed. Credentials sent here are ignored.',
  self: 'Any valid session, whatever the role.',
  account: `Any valid session whose role is one of: ${ROLES.join(', ')}.`,
  staff: `Any valid session whose role is one of: ${STAFF_ROLES.join(', ')}. The handler then applies its own role and permission checks.`,
  customer: 'Customer sessions only (reserved).'
};

function operationId(method, routePath) {
  const words = routePath.replace(/[:{}]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  return method.toLowerCase() + words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

export function buildOpenApi() {
  const paths = {};
  const extras = {};
  for (const [key, audience] of Object.entries(ROUTE_DECLARATIONS)) {
    const method = key.slice(0, key.indexOf(' '));
    const routePath = key.slice(key.indexOf(' ') + 1);
    if (routePath === '*') {
      extras['x-linecart-fallback'] = {
        method,
        audience,
        description: 'Any other GET serves the web app (text/html); unknown /api/* paths answer 404 JSON.'
      };
      continue;
    }
    const oaPath = routePath.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...routePath.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      name: m[1], in: 'path', required: true, schema: { type: 'string' }
    }));
    const responses = {
      200: { description: 'Success. JSON bodies mirror the HTTP status in `status`.', content: { 'application/json': { schema: { $ref: '#/components/schemas/StatusBody' } } } }
    };
    if (audience !== 'public') {
      responses[401] = { $ref: '#/components/responses/Unauthorized' };
      responses[403] = { $ref: '#/components/responses/Forbidden' };
    }
    const op = {
      operationId: operationId(method, routePath),
      summary: `${method} ${routePath}`,
      description: AUDIENCE_TEXT[audience] + (isLegacyAlias(routePath) ? ' Legacy alias kept for installed apps.' : ''),
      'x-linecart-audience': audience,
      security: audience === 'public' ? [] : [{ bearerAuth: [] }, { sessionToken: [] }, { legacyToken: [] }],
      responses
    };
    if (params.length) op.parameters = params;
    if (isLegacyAlias(routePath)) op['x-linecart-legacy-alias'] = true;
    paths[oaPath] = paths[oaPath] || {};
    paths[oaPath][method.toLowerCase()] = op;
  }
  const sortedPaths = Object.fromEntries(Object.keys(paths).sort().map((p) => [p, paths[p]]));
  return {
    openapi: '3.1.0',
    info: {
      title: 'LineCart API',
      version: 'phase0-stage-a',
      description: 'Generated from server/access.js by scripts/generate-openapi.mjs. Do not edit by hand. ' +
        'Send the session token as Authorization: Bearer and/or X-Session-Token (X-Token is also accepted); ' +
        'every header sent must carry the same token. Cookies are not used.'
    },
    servers: [{ url: '/' }],
    paths: sortedPaths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        sessionToken: { type: 'apiKey', in: 'header', name: 'X-Session-Token' },
        legacyToken: { type: 'apiKey', in: 'header', name: 'X-Token' }
      },
      schemas: {
        StatusBody: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { description: 'Mirrors the HTTP status (legacy field; /health reports "healthy").', oneOf: [{ type: 'integer' }, { type: 'string' }] },
            message: { type: 'string' }
          },
          additionalProperties: true
        },
        ErrorBody: {
          type: 'object',
          required: ['status', 'message', 'code'],
          properties: {
            status: { type: 'integer' },
            message: { type: 'string' },
            code: { type: 'string', enum: [...AUTH_401_CODES, ...AUTH_403_CODES] }
          },
          additionalProperties: true
        }
      },
      responses: {
        Unauthorized: {
          description: `No usable session. code is one of ${AUTH_401_CODES.join(', ')}.`,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } }
        },
        Forbidden: {
          description: 'The session may not do this. code is ROLE_NOT_ALLOWED (role outside the route audience) or FORBIDDEN (handler check).',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } }
        }
      }
    },
    ...extras
  };
}

export function renderOpenApi() {
  return JSON.stringify(buildOpenApi(), null, 2) + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const text = renderOpenApi();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OPENAPI_PATH) ? fs.readFileSync(OPENAPI_PATH, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text) {
      console.error('docs/openapi.json is out of date. Run: node scripts/generate-openapi.mjs');
      process.exit(1);
    }
    console.log('docs/openapi.json is up to date.');
  } else {
    fs.mkdirSync(path.dirname(OPENAPI_PATH), { recursive: true });
    fs.writeFileSync(OPENAPI_PATH, text);
    console.log(`Wrote ${path.relative(repoRoot, OPENAPI_PATH)} (${Object.keys(ROUTE_DECLARATIONS).length} routes).`);
  }
}
