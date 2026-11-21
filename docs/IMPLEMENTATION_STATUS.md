# LineCart implementation status

Last updated: 21 Nov 2026. Baseline: commit `380a99c`.

## Checklist

| Step | Item | Status | Commit |
|---|---|---|---|
| 0 | Toolchain, clone, CLAUDE.md, safe test runner (`npm test`) | Done | `77e31d0` |
| PR-1 | Async route error handling, request ids, JSON error logs, process handlers | Done | `878e131` |
| PR-2 | Concurrency-safe identifiers (advisory locks); embedded SQLite transactions serialised | Done (PostgreSQL path not yet run, see below) | `da07168` |
| PR-4 | Server-authoritative pricing; duplicate guard only for keyless requests | Done | `0a4dc8c` |
| PR-3 | Online-only order creation; offline order queue removed | Done (browser-tested) | `48e2520` |
| PR-5 | Admin setup requires SETUP_TOKEN in production; never overwrites accounts | Done | `51514ba` |
| PR-6 | Stored XSS on map screens | Done (browser-tested) | `de0a6f2` |
| PR-7 | Browser and device storage safety, logout cleanup | Next | |
| PR-8 | Backup and restore fidelity | Pending (test-runner part done) | |
| PR-9 | Node and Render compatibility | Blocked: Render Node version unknown | |
| 5 | Functional fixes (delivery, payments, scope, passwords, lockout, demo data, permissions, validation, health, maintenance, logging) | Pending | |
| 6 | UI and connectivity pass | Pending | |
| 7 | Android manifest, versioning, signing config, release build | Pending | |
| 8 | Final regression and release | Pending | |

## Behaviour changes to know about
- **Orders are online-only.** The Place order button is disabled with a banner when the server is unreachable. Orders queued offline by older app versions are shown as "Not sent" in the sync panel (never auto-sent) and can be discarded after re-entry.
- **Order prices come from the server only.** Unknown, archived or unpriced items are rejected with 400.
- **Two orders with the same total are no longer merged** when each has its own idempotency key. The 5-second double-tap guard still applies to keyless clients.
- **Admin setup in production** needs `SETUP_TOKEN` sent as `Authorization: Setup <token>`.
- **New optional server settings:** `SETUP_TOKEN`, `MIN_ORDER_CLIENT_LEVEL` (set to `2` after the new APK is rolled out).
- **New endpoint:** `GET /api/ping` (no auth, no database).

## Test results

| Date | Commit | Result |
|---|---|---|
| 21 Nov 2026 | `380a99c` unmodified, clean DB | 87 of 95 passed. All 8 failures were missing fixture data from a private `data.js`. |
| 21 Nov 2026 | `de0a6f2` | 14 of 14 suites passed (all existing tests plus 8 new suites) |

What the tests cover:
- **Automated:** `npm test` (embedded SQLite).
- **Browser:** local server in the built-in browser pane:
  - Online order placement and blocking when the server is unreachable.
  - XSS payloads on the manager map and the delivery route map.
- **Not yet run:** PostgreSQL, Android emulator, physical device, production.

## Blockers needing the owner
- **GitHub push:** run `gh auth login` once (commits are local until then).
- **Production API URL:** no production service exists yet. `linecart-backend.onrender.com` returns 404; only staging is live.
- **Render Node version:** check the service's Environment (`NODE_VERSION`) or the build log.
- **Release keystore:** the owner creates it and keeps the passwords.
- **Device testing:** needs a phone with USB debugging, or an emulator.
- **PostgreSQL verification:** the advisory-lock path (PR-2) runs only on Postgres. A local disposable PostgreSQL install is needed to run the suite against it.

## Known issues found during work
- Staging stores shop photos on local disk (`storage.provider: local-disk`), so photos are lost on redeploy. Configure Supabase Storage.
- Staging `/health` publicly returns user, shop and order counts (fix planned in step 5).
- The current APK has no CAMERA permission, so visit-photo capture (`getUserMedia`) can fail (fix planned in step 7).
- Embedded SQLite (dev only): statements run outside a transaction can still interleave with a concurrent transaction on the single connection. Production uses PostgreSQL.
- The `INITIAL_ADMIN_PHONE`/`INITIAL_ADMIN_PASSWORD` boot path (`db.js`) can still update an existing admin row. It is operator-controlled (needs server environment access).
