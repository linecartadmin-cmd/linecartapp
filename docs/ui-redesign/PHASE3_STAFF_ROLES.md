# UI redesign Phase 3: Field Sales Agent, Sales Manager and Admin (local branch, not deployed)

Branch `ui-redesign-foundation`. Commits `7868ae6`, `3c4330d`, `05432ee`, `81d3a0c`, `4535cfb`, `c85836a`, `7e117a5` and this documentation commit. Nothing pushed, merged or deployed. The Customer role is reserved and was not redesigned.

## Approach
The remaining staff screens are large, working screens (orders, approvals, targets, reports, maps, visits). Rewriting each one would have put payments, approvals, GPS, photos and exports at risk for a visual change. Instead:

- **One shared styling layer**, `client/src/styles/legacy-bridge.css`, loaded after the legacy theme. It applies the Market Ledger tokens to every pre-redesign screen inside the new shell and to sign-in: headings, surfaces, metric cards, buttons, inputs and filters (16px text so phones do not zoom), tabs, tables, status pills, empty states, and the legacy modals (header, body, footer, 44px close button). Text set below 12px inline, in rem or with Tailwind classes is raised to 12px. It is scoped to `.lc-main .page-content` and `.lc-login` only, so the Delivery Agent screen and the new primitives are untouched (enforced by `tests/ui-roles.test.js`).
- **New components where a screen lacked something essential.** The Field Sales Agent overview gained a "Today" panel (`AgentTodayPanel.jsx`) built from the Phase 1 primitives.
- **Decorative emoji removed** from 26 headings, labels and buttons. The ✕ close glyph is kept wherever Android hardware back uses it to find a screen's close control.
- Component names, page ids, props, API calls and queue calls are unchanged.

## By role
| Role | Screens | What changed |
|---|---|---|
| Field Sales Agent | Overview (Today), Shops / add shop, New order, My visits, Reports, Summary | Today panel: visits today (X of Y, progress bar), orders and value placed today, shops without a location pin, next five shops not yet visited with an Order shortcut that preselects the shop. Data comes only from `GET /api/visits/my-shops` and the orders App already loads; a figure that fails to load says "Unavailable", never zero. Time-of-day greeting. Order entry item panel no longer overflows the card on phones. All other screens restyled through the shared layer. |
| Sales Manager | Reports (dashboard), Orders, Price approvals, Items, Map, Field visits, Team, Shops | Restyled through the shared layer. The top-bar approvals count now refreshes as soon as a price request is approved or rejected (it previously stayed at the old count until the next poll). |
| Admin | Overview, Users, Roles and permissions, Assignments, Targets, Orders, Price approvals, Items and pricing, Reports, Map, Field visits, Delivery, Shops, Audit, Settings | Restyled through the shared layer, including every modal: add/edit user, add product, update daily price, price history, edit product, set target. Small rem-sized modal labels raised to 12px. |
| Shared | Sign-in, shell, navigation, toasts, dialogs, Android back, offline/sync indicator | Shell, navigation, toasts, dialogs and Android back come from Phase 1. Sign-in restyled. |

## Preserved
- The same endpoints, request bodies and route ids; no API, permission or schema change in this phase.
- Order creation online-only; offline queue for delivery status and price updates unchanged.
- The order-status integrity fix (`51c64b9`, `38a99ca`): closed orders cannot be reopened; refused queued updates stay failed and the phone shows the server status.
- GPS capture, shop photos, visit verification, payments, approvals, reports and exports: same code paths, restyled only.

## Verification (23 Nov 2026, local server and disposable SQLite only)
| Check | Result |
|---|---|
| Every page of every staff role at 360, 768 and 1280 (headless Edge, 30 role/page pairs) | No error boundary, no uncaught exceptions, no horizontal page overflow; shell probe found a minimum shell font of 12px. Screenshots in `docs/screenshots/ui-redesign-full/` (git-ignored). |
| Field Sales Agent: Today → Order on a shop → order with a requested price → place order | Shop preselected; order placed at catalog price; toast "Customer price request sent for approval". |
| Sales Manager: approve that price request | Confirmation dialog in Market Ledger style; approved; approvals badge went from 1 to 0 immediately (after the fix). |
| Field Sales Agent: register a shop with a long Tamil name and address | Saved; the name wraps without overflow on Shops, Overview, My visits and New order at 360px; the Today list no longer breaks words (after the fix). |
| Full suite (SQLite) and client build at `c85836a` | 30 suites, 393 tests, 0 failures; `vite build` passed. |
| Admin modals at 390px | Add/edit user, add product, update price, price history, edit product, set target: inside the viewport, no controls cut off, no text under 12px (after the fix), each closes. |
| Admin Roles, Assignments, Audit, Settings at 390px | Load, no horizontal overflow. |

## Android emulator walkthrough (23 Nov 2026)
Emulator `linecart_test` (Android 15, 1080x2400), local APK `in.linecart.suite.local` (`scripts/inspect-apk.mjs`: package and local API URL correct, no secrets), local server only (`http://10.0.2.2:3001`, disposable SQLite), local demo accounts.

| Role | Check | Result |
|---|---|---|
| Field Sales Agent | Sign-in, Today panel | Real counts (0 of 5 visits, 9 orders today, 1 shop without a pin), next shops listed. |
| Field Sales Agent | Order shortcut, hardware back | New order opened with the shop preselected; back returned to Overview. |
| Field Sales Agent | Shops → Add customer → hardware back | Found that back left Shops and dropped the form; fixed (`7e117a5`); after the fix back returns to the shop list. |
| Field Sales Agent | My visits with long English and Tamil names | Found the status pill stretching into a tall shape; fixed (`7e117a5`); after the fix the pill stays compact. |
| All | Sign out, sign in as another role | Works; the next user signs in normally. |
| Sales Manager | Reports dashboard, Configure target dialog, hardware back, Approvals tab | Dialog styled and inside the screen; back closed it; Approvals shows the empty state after the earlier approval. |
| Admin | Overview, Users, Create New User dialog, hardware back, Items | Dialog styled, fields full width; back closed it; Items metrics and actions render. |

Not exercised on the emulator: GPS fetch and camera photo (unchanged code paths; covered by `tests/visit-client.test.js` and earlier field-visit testing), offline mode for staff roles (order creation is online-only by decision; the delivery offline queue was walked through in Phase 2).

## Not done / not verified
- Screens were restyled, not rebuilt: tables on Admin and Manager screens remain the legacy tables (scroll horizontally inside their card on phones) rather than card lists.
- Some emoji remain inside data-heavy screens (for example 📍 Fetch GPS and 📷 Take Camera Photo on order entry, 📦 Team Orders and the ✅ empty state on Price approvals).
- After reinstalling the APK the app asked for the password again (the account was remembered); not investigated, as the session code was not changed in this phase.
- Tamil exists only for the Delivery Agent screen; other staff screens are English (as before). Tamil data (shop names, addresses) was checked.
- Sales Manager Team and Field visits, and Admin Reports exports, were checked for loading and layout only, not for every action.
- Dark mode not implemented (not approved).

## Final polish (23 Nov 2026, commits `28abbcc`, `9190693`)
- **Today's Visits** at the top of the Field Sales Agent Visits screen: the number of this agent's `verified` visit records dated today (IST), from the new additive field `counts.verifiedVisitsToday` on `GET /api/visits/my-shops`. Same definition as every visit summary (`docs/FIELD_VISITS.md`): repeat visits to one shop count separately, flagged visits count only after approval (shown as "N awaiting manager review"), failed attempts never count; other agents and other days are excluded. Skeleton while loading, "Unavailable" on failure, never zero. Tests: `tests/visits-today-count.test.js` (3), `tests/ui-roles.test.js`.
- **Tables on phones**: below 768px every pre-redesign staff table shows each row as a labelled card (labels from the column headers, `client/src/shell/responsiveTables.js`); action buttons get their own row. Tablet and desktop keep the table. Tables with merged header cells keep horizontal scrolling.
- **Icons**: Admin navigation tiles, save buttons (roles, settings, assignments), Manage Team, Team Orders tab, PNG export, Update Price, edit/archive/restore, Fetch GPS, camera, upload photo, use-current-location and password show/hide now use lucide icons. Emoji in empty states, offline banners and secondary details were left.

| Check | Result |
|---|---|
| Browser, all staff pages at 360/768/1280 (30 role/page pairs) | No error boundary, exceptions or page overflow. Every Manager/Admin table visible at 360px became cards; Users card actions on their own row; Edit opens the dialog. At 768px the table stays a table. |
| Browser, Today's Visits | Count shown; loading skeleton (request held open); "Unavailable" when the request fails. |
| Browser, Tamil (Delivery screen) | Tamil labels, buttons and tabs at 360px; no overflow (the "All stops (11)" tab wraps to three lines). |
| Android emulator | Today's Visits 0 → a GPS-verified visit at Sunrise Fresh Produce (location permission prompt, emulator fix 22 m from the shop, ±5 m) → Today's Visits 1. Fetch GPS on New order (±5 m). Camera permission prompt, in-app camera, Capture & Attach, thumbnail preview. Airplane mode: "Offline: cannot place order", entries kept; back online re-enabled it. Admin dashboard tables as cards. Sign-out and sign-in between Admin and Field Sales Agent. |
| Full SQLite suite | 31 suites, 412 tests, 0 failures. Client build passed. Local APK built and inspected (package `in.linecart.suite.local`, API `http://10.0.2.2:3001`, no secrets). |
