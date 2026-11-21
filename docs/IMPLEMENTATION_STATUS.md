# LineCart implementation status

Last updated: 21 Nov 2026. Baseline: commit `380a99c`.

## Checklist

| Step | Item | Status |
|---|---|---|
| 0 | Toolchain, clone, CLAUDE.md, safe test runner (`npm test`) | Done |
| PR-1 | Async route error handling | Pending |
| PR-2 | Concurrency-safe identifiers | Pending |
| PR-4 | Server-authoritative pricing | Pending |
| PR-3 | Remove offline order creation | Pending |
| PR-5 | Admin setup requires SETUP_TOKEN | Pending |
| PR-6 | Stored XSS on map screens | Pending |
| PR-7 | Browser and device storage safety | Pending |
| PR-8 | Backup and restore fidelity | Pending (test-runner part done) |
| PR-9 | Node and Render compatibility | Blocked: Render Node version unknown |
| 5 | Functional fixes (delivery, payments, scope, passwords, lockout, demo data, permissions, validation, health, maintenance, logging) | Pending |
| 6 | UI and connectivity pass | Pending |
| 7 | Android manifest, versioning, signing config, release build | Pending |
| 8 | Final regression and release | Pending |

## Test results

| Date | Commit | Result |
|---|---|---|
| 21 Nov 2026 | `380a99c` unmodified, clean DB | 87 of 95 passed. All 8 failures were missing fixture data (shops 33/34/36/40, order S101-24019) from a private `data.js`. |
| 21 Nov 2026 | Step 0 | 98 of 98 passed (95 existing, plus 3 new safety tests) |

## Blockers needing the owner
- **GitHub push:** run `gh auth login` once.
- **Production API URL:** no production service exists yet. `linecart-backend.onrender.com` returns 404; only staging is live.
- **Render Node version:** check the service's Environment (`NODE_VERSION`) or the build log.
- **Release keystore:** the owner creates it and keeps the passwords.
- **Device testing:** needs a phone with USB debugging, or an emulator.

## Known issues found during work
- Staging stores shop photos on local disk (`storage.provider: local-disk`), so photos are lost on redeploy. Configure Supabase Storage.
- Staging `/health` publicly returns user, shop and order counts (fixed in step 5).
- The current APK has no CAMERA permission, so visit-photo capture (`getUserMedia`) can fail (fixed in step 7).
