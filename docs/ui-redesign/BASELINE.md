# UI redesign baseline (before Phase 1)

Captured 23 Nov 2026 from branch `ui-redesign-foundation` at its starting commit `bbe9feb` (Stage A, unchanged client).

## How it was captured
- Local server only: `scripts/dev-local.mjs` against a fresh, disposable SQLite file (never `server/data/dev-local.db`, never a remote database).
- Client: production build of the unchanged client (`npm run build --prefix client`), served by the local server.
- Accounts: the local development demo accounts the server seeds on non-production runs (`DEV_DEMO_ACCOUNTS` in `server/index.js`), one per staff role.
- Local test data created through the app's own API and labelled `UI-REDESIGN TEST`: two orders by the Field Sales Agent, one with a requested price (one pending price request); both orders are assigned to the local Delivery Agent.
- Screenshots: headless Microsoft Edge driven over the DevTools protocol, full page, widths 360 px (mobile emulation), 768 px and 1280 px.
- Output: `docs/screenshots/ui-redesign-baseline/<role>/<page>-<width>.png` (93 files). That folder is git-ignored on purpose (`docs/screenshots/` may hold account details), so the images stay on this machine.

Note: full-page captures stitch the page at one viewport height, so fixed elements (the desktop sidebar, the phone bottom bar) appear once at their viewport position rather than at the bottom of the image.

## Screens captured

| Role | Page ids (hash routes) | Count |
|---|---|---|
| Signed out | sign-in screen | 1 |
| Admin | admin-dashboard, admin-users, admin-roles, admin-assignments, admin-targets, orders, price-requests, items, reports, map, field-visits, delivery, customers, admin-audit, admin-settings | 15 |
| Sales Manager | reports, orders, price-requests, items, map, field-visits, team, customers | 8 |
| Field Sales Agent | overview, orders, visits, reports, customers, summary | 6 |
| Delivery Agent | delivery | 1 |

Every screen loaded: no error boundary, no JavaScript exception, no horizontal page overflow at any of the three widths.

## Not covered by the baseline
- Android native behaviour (biometric unlock, native GPS plugin, camera): needs the emulator; not part of a browser capture.
- Dialogs and secondary states (order detail, create user, delivery payment step, visit check-in results) were not opened; only the landing state of each page was captured.
- Live map tiles come from the public tile server and rendered normally during capture.

## Observations recorded at baseline (not fixed in Phase 1 unless listed in the Phase 1 scope)
- The top-bar label reads "Overview" on `price-requests`, `field-visits` and `visits` because `pageLabels` in `App.jsx` has no entry for them.
- The notification bell always shows a dot and only shows a fixed message.
- The "Mobile preview" toggle shows for every desktop user.
- Admin phone bar: 8 buttons; Assignments, Targets, Approvals, Reports, Map, Delivery and Audit have no phone entry. Sales Manager phone bar has no Price Approvals entry.
- The Delivery screen draws a second header (with its own sync indicator, view toggle and sign out) under the shell's top bar.
- Signing in with the shared demo phone number for the Field Sales Agent resolves to the `data.demo.js` agent (id 1), not the dev demo agent (id 6). Local data only; no effect on production.
