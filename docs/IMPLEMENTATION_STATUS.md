# LineCart implementation status

Last updated: 22 Nov 2026. Baseline: commit `380a99c`.

## Checklist

| Step | Item | Status | Commit |
|---|---|---|---|
| 0 | Toolchain, clone, CLAUDE.md, safe test runner (`npm test`) | Done | `77e31d0` |
| PR-1 | Async route error handling, request ids, JSON error logs, process handlers | Done | `878e131` |
| PR-2 | Concurrency-safe identifiers (advisory locks); embedded SQLite transactions serialised | Done (verified on PostgreSQL 17 on 22 Nov) | `da07168` |
| PR-4 | Server-authoritative pricing; duplicate guard only for keyless requests | Done | `0a4dc8c` |
| PR-3 | Online-only order creation; offline order queue removed | Done (browser-tested) | `48e2520` |
| PR-5 | Admin setup requires SETUP_TOKEN in production; never overwrites accounts | Done | `51514ba` |
| PR-6 | Stored XSS on map screens | Done (browser-tested) | `de0a6f2` |
| PR-7 | Visit photos out of order lists; guarded device cache; sign-out clears device data | Done (browser-tested) | `029e3f7` |
| PR-8 | Complete read-only backups; validated atomic restores | Done | `b436ccb` |
| PR-9 | Node and Render compatibility | Blocked: Render Node version unknown | |
| F-1 | GPS-verified shop visits (migration 007, API, agent/manager/admin screens, Android mock-location plugin); see `docs/FIELD_VISITS.md` | Done (automated on SQLite + PostgreSQL 17, browser-tested; physical device pending) | `25e4e72`, `176bf86` |
| T-1 | Test suite runs on a local PostgreSQL as well as SQLite | Done | `4f2db71` |
| 5 | Functional fixes (delivery, payments, scope, passwords, lockout, demo data, permissions, validation, health, maintenance, logging) | Pending | |
| 6 | UI and connectivity pass | Pending | |
| 7 | Android manifest, versioning, signing config, staging/production separation, build script; emulator-tested (see `docs/ANDROID_BUILD.md`) | Done except signed release: needs the owner's keystore and a production API URL | this commit |
| 8 | Final regression and release | Pending | |

## Behaviour changes to know about
- **Orders are online-only.** The Place order button is disabled with a banner when the server is unreachable. Orders queued offline by older app versions are shown as "Not sent" in the sync panel (never auto-sent) and can be discarded after re-entry.
- **Order prices come from the server only.** Unknown, archived or unpriced items are rejected with 400.
- **Two orders with the same total are no longer merged** when each has its own idempotency key. The 5-second double-tap guard still applies to keyless clients.
- **Admin setup in production** needs `SETUP_TOKEN` sent as `Authorization: Setup <token>`.
- **New optional server settings:** `SETUP_TOKEN`, `MIN_ORDER_CLIENT_LEVEL` (set to `2` after the new APK is rolled out).
- **New endpoints:** `GET /api/ping` (no auth, no database); `GET /api/orders/:id/visit-photo` (order lists no longer carry photos, only `hasVisitPhoto`).
- **Sign-out** removes that user's biometric credential, saved account entry and cached data from the device (unsent delivery/price updates are kept, with a warning).
- **Backups** (`npm run db:backup`) are now complete and read-only; old backup files restore only with `--accept-lossy`. Make a fresh backup with the new format.

## Test results

| Date | Commit | Result |
|---|---|---|
| 21 Nov 2026 | `380a99c` unmodified, clean DB | 87 of 95 passed. All 8 failures were missing fixture data from a private `data.js`. |
| 21 Nov 2026 | `de0a6f2` | 14 of 14 suites passed (all existing tests plus 8 new suites) |
| 21 Nov 2026 | `b436ccb` | 16 of 16 suites passed |
| 22 Nov 2026 | Android 1.1.0 changes | 212 of 212 tests on SQLite; client production build passes; staging and local debug APKs built; unsigned release APK built; emulator tests listed below |
| 22 Nov 2026 | `4f2db71` + docs | 19 of 19 suites, 212 of 212 tests on SQLite and on PostgreSQL 17; client production build passes; Android `:app:compileDebugJavaWithJavac` passes; migration 007 upgrade of a populated pre-007 PostgreSQL database passes |

What the tests cover:
- **Automated:** `npm test` (embedded SQLite) and `LINECART_TEST_PG_URL=postgresql://...@127.0.0.1:<port>/<db> npm test` (disposable local PostgreSQL; localhost only).
- **Browser:** local server in the built-in browser pane:
  - Online order placement and blocking when the server is unreachable.
  - XSS payloads on the manager map and the delivery route map.
  - Shop visits with simulated GPS (verified, too far, poor accuracy); manager summary, visit log, map, location editor.
- **Android emulator** (22 Nov 2026, AVD Pixel 7 / API 35, APK 1.1.0):
  - Staging build: connects to `linecart-staging.onrender.com` from inside the app (`/api/ping` 200, authenticated routes 401 without a token), and the STAGING banner shows.
  - Local build against `scripts/dev-local.mjs`: all four roles (agent, manager, admin, delivery) sign in, and every bottom-nav screen opens with no error boundary, horizontal overflow or JS error. Sign-out clears the token.
  - Field visits through the native plugin: fresh GPS fix (fix age under 1 s, `isMock` false) verified at 40 m; mock location (test provider) flagged "sent for review"; Location turned off shows the GPS-off message; permission denied shows the permission message.
  - Release build without a keystore produces an unsigned APK and logs that signing is missing.
- **Not yet run:** physical device, visit-photo camera capture on Android, signed release, production.

## Blockers needing the owner
- **Production API URL:** no production service exists yet. `linecart-backend.onrender.com` returns 404; only staging is live.
- **Render Node version:** check the service's Environment (`NODE_VERSION`) or the build log.
- **Release keystore:** the owner creates it and keeps the passwords (steps in `docs/ANDROID_BUILD.md`). Until then, release builds are unsigned.
- **Staging test accounts:** role testing against staging needs the owner's staging logins; emulator role tests used local demo data.
- **Physical device testing:** emulator tests passed; still needed on a real phone: real GPS accuracy indoors and outdoors, real mock-location apps, camera capture, biometric unlock, and Android 7-11 versus 12 or later behaviour.

## Behaviour changes from field visits (F-1)
- New pages: **My Visits** (Field Sales Agent) and **Field Visits** (Sales Manager, Admin). Migration 007 adds them to stored role permissions once; admin customisations are kept.
- New settings in Admin → Field Visits → Verification settings (defaults: 100 m radius, ±30 m accuracy, 30-minute duplicate window).
- Shops with no coordinates (stored as 0,0) show "Shop location not registered" until a manager or admin sets their location.

## Production read-only audit (22 Nov 2026)
The existing Render service (`linecart-staging.onrender.com`) and its Supabase database are production. A read-only audit with the four real role accounts got 64 PASS, 3 FAIL, 2 REVIEW, 3 INFO:
- **Passed:** sign-in, sessions, sign-out, 36 role-restriction checks, and agent/manager/delivery data scope. Admin totals match the database (316 shops, 7 orders, 5 users). No password or token fields in responses.
- **Fixed in code (not yet deployed):** `GET /api/orders` returned no orders for Delivery Agents because it filtered on a field that is never set. It now uses `deliveryAgentId`, the same field as `/api/delivery/orders`.
- **Open:**
  - Photos are on local disk, and the 313 existing shop photo names are not served by this server.
  - The service restarts when idle (probably Render's free plan), which also wipes local files.
  - A Delivery Agent is listed in a Sales Manager's sales team.
  - Managers see every shop in their cluster, not only their team's (rule to confirm).

## Known issues found during work
- The project lives in OneDrive. OneDrive turns some Gradle build output folders into read-only placeholders, which can fail an Android build with `AccessDeniedException`. Delete the named folder and rebuild, or keep the project (or at least `client/node_modules` and `client/android/build`) outside OneDrive.
- `server/migrate.js` (default command, no flags) seeds an outdated copy of the role permissions on an empty database; the server's own defaults differ. Low impact (insert-only), fix planned in step 5.
- Pushing to `main` auto-deploys `linecart-staging.onrender.com`.
- Staging stores shop photos on local disk (`storage.provider: local-disk`), so photos are lost on redeploy. Configure Supabase Storage.
- Staging `/health` publicly returns user, shop and order counts (fix planned in step 5).
- Older APKs (before 1.1.0) have no CAMERA permission, so visit-photo capture can fail on them. 1.1.0 adds it.
- Push notifications do not exist in the app (no Firebase configuration).
- Embedded SQLite (dev only): statements run outside a transaction can still interleave with a concurrent transaction on the single connection. Production uses PostgreSQL.
- The `INITIAL_ADMIN_PHONE`/`INITIAL_ADMIN_PASSWORD` boot path (`db.js`) can still update an existing admin row. It is operator-controlled (needs server environment access).
