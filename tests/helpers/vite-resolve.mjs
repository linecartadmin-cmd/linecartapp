/**
 * Test-only module resolve hook: lets Node import client modules that use Vite-style
 * extensionless relative imports (e.g. `import { api } from './api'`).
 * Usage (top of a test file): import './helpers/vite-resolve.mjs';
 */
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (err) {
          if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z]+$/i.test(specifier)) {
            for (const ext of ['.js', '.jsx', '/index.js']) {
              try { return await next(specifier + ext, context); } catch {}
            }
          }
          throw err;
        }
      }
    `),
  import.meta.url
);
