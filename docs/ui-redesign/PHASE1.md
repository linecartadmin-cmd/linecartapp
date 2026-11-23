# UI redesign Phase 1: foundation (local branch, not deployed)

Branch `ui-redesign-foundation`, started from `phase0-stage-a` at `bbe9feb`. Nothing has been pushed, merged or deployed.
Design reference: the approved "LineCart Redesign Proposal" (Market ledger direction).

## What this phase adds
| Area | Files | Notes |
|---|---|---|
| Baseline | `docs/ui-redesign/BASELINE.md` | 30 screens x 3 widths captured locally; images in git-ignored `docs/screenshots/` |
| Tokens and type | `client/src/styles/tokens.css`, `base.css`, `client/public/fonts/` | `--lc-*` tokens, light theme only. Inter, Manrope and Noto Sans Tamil self-hosted (OFL); Google Fonts removed. Zoom re-enabled in the viewport meta. Legacy variables keep their values. |
| Tailwind | `client/tailwind.config.js` | `brand` (unused by screens) now LineCart blue; new `lc-*` keys read the tokens; default scales untouched. |
| UI primitives | `client/src/ui/` | Button, IconButton, Icon, Field/TextInput/SearchInput/Select/TextArea, QuantityStepper, SegmentedControl, Card, List/ListItem, StatusPill, Dialog, ConfirmDialog, BottomSheet, Toast/useToast, EmptyState, Skeleton, Metric, ProgressBar, DataTable, FilterBar |
| Dev gallery | `client/src/dev/ComponentGallery.jsx` | `npm run dev --prefix client`, open `http://localhost:3000/#dev-gallery`. Removed from production builds by `import.meta.env.DEV`. |
| App shell | `client/src/shell/` | AppShell, SideNav (sidebar >= 1024 px, rail 600-1023 px), BottomNav (<= 4 + More), TopBar, MoreSheet, ProfileMenu, navConfig |
| Approvals indicator | `App.jsx`, `shell/TopBar.jsx` | Admin and Sales Manager only; count from `GET /api/price-requests?status=pending` |
| Toasts and dialogs | `ui/Toast.jsx`, `ui/toastVariant.js`, `App.jsx` | `showToast(message)` unchanged for callers; queued; errors persist; sign-out confirmation uses ConfirmDialog |
| Dev-only preview | `App.jsx` | Phone preview frame and the Delivery view switch exist only in dev builds |
| Android back | `shell/useAndroidBackButton.js`, `@capacitor/app` 8.1.2 | See below |
| Tests | `tests/ui-navigation.test.js` | 45 tests: navigation/permission consistency, back order, toast variants |

## Navigation per role (same destinations as before; grouping and labels changed)
- **Admin** (home Overview): Overview; Operations: Orders, Price approvals, Delivery fleet, Field visits; Catalogue: Items & daily prices; People & territory: Users, Team assignments, Targets, Shop map; Insights: Reports; System: Roles & permissions, Audit log, Settings. Phone: Overview, Orders, Approvals, Items, More.
- **Sales Manager** (home Reports): Team: Reports & performance, Field visits, My sales team; Orders: Team orders, Price approvals (needs the `orders` permission, as before), Items & daily prices; Shops: Shops, Shop map. Phone: Reports, Orders, Approvals, Shops, More.
- **Field Sales Agent** (home Overview): Overview, New order, My visits, Shops; Reports: Reports, Summary report. Phone: Home, Shops, Order, Visits, More.
- **Delivery Agent**: Delivery route. Phone: Route, Account.
- Profile and Sign out: avatar menu in the top bar on every width, and in the More/Account sheet on phones.

Unchanged: page ids, hash routes, `isPageAllowed()`, role homes, the in-app history stack, `handleLogout` cleanup, every API call and every screen's own content.

## Approval indicator rules
- Shown only to Admin, and to Sales Managers who have the `orders` page permission.
- Number shown only after a successful live response. No number while loading, after an error, after a server refusal, or when the API layer answers from the offline cache (`cached: true`).
- Refreshes on load and on the existing `linecart:orders_updated` / `linecart:price_requests_updated` events, not on every render.

## Android hardware back
Order: (1) close the top dialog, sheet or menu built with the new primitives; (2) a modal built by an existing screen (class-based, ARIA dialog, Tailwind full-screen overlay, or inline `position: fixed` full-screen box): press its own close control (`.modal-close`, an `aria-label="Close"` button, or a button whose only text is ✕/✖/×); if it has none, do nothing, so a form or a confirmation is never left by accident. Text buttons such as "Cancel" are never pressed. (3) On the role home screen, move the app to the background (`App.minimizeApp`). (4) Otherwise follow the in-app history (`handleBack`). It never signs out and never touches cached data or the offline queue. Browsers are unaffected.

### Existing-screen modals and back (review, 23 Nov 2026)
| Screen | Modal | Back |
|---|---|---|
| Admin users | Create user, Edit user | Closes (`.modal-close`) |
| Admin targets | Target form | Closes (`.modal-close`) |
| Orders and approvals (Admin, Manager) | Decision, order detail, create, edit, cancel, delete | Closes (`.modal-close`) |
| Items & daily prices | Price, history, product form | Closes (✕ button) |
| Items & daily prices | Server price conflict | Blocked (must choose) |
| Manager reports | Configure agent sales target | Closes (✕ button). Before the review, back navigated away under it. |
| Sync status | Sync queue panel | Closes (✕ button) |
| Order entry | In-app camera | Blocked (no close glyph; use the dialog buttons) |
| Delivery route | Pick up, could not deliver, payment, delivered summary | Blocked (only Cancel or a choice; never auto-cancelled) |


## Intentionally not done in Phase 1
- No screen-by-screen migration (Delivery, Order entry, Reports and the rest keep their current content and styles).
- No dark mode. No change-password entry, no forced password prompt, no change to authentication or password endpoints.
- Unused components (`AdminDashboard`, `DeliveryDashboard`, `ClustersShops`, `RegisterShop`, `ChangePasswordModal`) kept.
- `reference-theme.css` not trimmed; legacy rules are removed only as screens migrate.

## Toast API for migrated screens
Pass the type explicitly: `showToast(message, 'success' | 'error' | 'warning' | 'info')` or `showToast(message, { variant, duration })`. Errors never close themselves. Without a type, `ui/toastVariant.js` infers it from the wording (queued/offline wording is a warning; failure or input-problem wording is an error). Every 4xx/5xx message in `server/index.js` and `server/visits.js` is tested to never show as success or auto-closing info.

## Known issues and follow-ups
- Existing screens still use 9-11 px text, emoji and their own modal markup; they get the new primitives when migrated.
- The Delivery screen still draws its own dark header (with a second sync indicator and sign out) under the new top bar; planned for the Delivery redesign step.
- Toast variants for existing `showToast` calls are still inferred from wording; a few prompts may read as errors and persist until dismissed. Migrated screens should pass the type explicitly.
- Delivery confirmations, the camera dialog and the price-conflict choice do not close on Android back (by design until those screens are migrated to `Dialog`).
- Desktop with a mouse keeps 44 px controls by design; touch screens get 48 px.
- Android WebView zoom: the viewport meta now allows zoom, but the native WebView settings (`MainActivity`, text zoom fixed at 100) were not changed.
- Building in OneDrive: run Gradle with `LINECART_GRADLE_BUILD_ROOT` set (the build script does this) to avoid read-only build folders.

## Verification at the end of Phase 1 (23 Nov 2026, local only; superseded counts in the review section below)
- `npm test`: 27 of 27 suites, 314 of 314 tests passed (269 existing tests in 26 suites, plus 45 new in `ui-navigation.test.js`). No test was changed, skipped or weakened.
- `npm run build --prefix client`: passes. The production bundle contains no gallery code and no preview toggle.
- Browser (headless Edge and the built-in browser, local server, disposable SQLite, local demo accounts): 30 screens x 360/768/1280 px for all four roles; no error boundary, exception or horizontal overflow. Each role sees exactly its previous destinations; phone bar at most 5 targets; tablet rail at 768 px; sidebar at 1280 px. Screenshots: `docs/screenshots/ui-redesign-phase1/` (git-ignored).
- Approvals indicator: real count (1 seeded test request), zero hides the badge, network failure, server refusal and offline cache show no number, recovery restores it; no request on re-render; absent for Field Sales Agent and Delivery Agent.
- Dialogs and toasts: focus moves in and is trapped, Escape and scrim close, scroll lock, focus returns; Cancel focused first on destructive confirms; toasts queue three at a time; errors stay until dismissed. Sign-out with a staged local queue entry shows the confirmation; Stay signed in keeps the session and the queue; normal sign-out clears the session.
- Tamil: Delivery screen Tamil toggle renders with the self-hosted Noto Sans Tamil; long shop names and Tamil labels wrap in the gallery components.
- Android: `gradlew :app:compileDebugJavaWithJavac` passes (with `LINECART_GRADLE_BUILD_ROOT` outside OneDrive). Local APK (`in.linecart.suite.local`, backend `http://10.0.2.2:3001` only, no secrets per `inspect-apk.mjs`) on emulator `linecart_test` (Android 15): back from Shops returned to My visits, then to Overview; back with the More sheet open closed the sheet; back at Overview moved the app to the background; relaunch resumed the same process on Overview, still signed in.
- Not verified: physical device; back over each legacy screen modal on the device (covered by unit tests only); biometric unlock on a device with enrolled biometrics.

## Generated Android files
`client/android/capacitor.settings.gradle` and `client/android/app/capacitor.build.gradle` are generated by `npx cap sync android` and tracked in git. The working copy differs from HEAD only by the `@capacitor/app` registration (`include ':capacitor-app'` with its `projectDir`, and `implementation project(':capacitor-app')`). Before this work they were flagged modified with no content difference (an earlier description of "line-ending changes" was inaccurate). A clean export of the branch with `npm ci` and `cap sync` regenerates them byte-for-byte, and `scripts/build-android.mjs` syncs on every build. Recommendation: commit them so the repository matches `package.json`; not committed yet, pending the owner.

## Review and hardening pass (23 Nov 2026)
- Touch targets: 48 px on phones, tablets and any touch screen; small controls get an invisible 48 px hit area; desktop with a mouse keeps 44 px. Measured at 360 px: 0 of 48 gallery controls, 8 top/bottom bar controls, 12 More sheet controls and the profile menu below 48 px.
- Android back: legacy modal detection widened (see table above); one back on the home screen now leaves the app; top-bar back arrow only away from home.
- Toasts: wider failure vocabulary, no server failure classified as success or info, length-based durations, pause on hover or focus.
- Bottom bar: the approvals badge was clipped on Android; fixed.
- Tests after the pass: 27 of 27 suites, 330 of 330 tests (269 existing plus 61 in `ui-navigation.test.js`). One intermediate run had a failure in `route-access-sweep.test.js` because an APK build was rewriting `client/dist` at the same time; re-run alone, everything passed.
- Android after the pass: compile passes; clean export of HEAD (`npm ci`, `cap sync`, compile) passes; emulator checks listed in the final report.
- Screenshot inventory: `SCREENSHOT_INVENTORY.md`.

## How to review locally
1. `git log --oneline bbe9feb..ui-redesign-foundation` and `git diff bbe9feb..ui-redesign-foundation --stat`.
2. `npm test` (needs port 3001 free).
3. `npm run build --prefix client`.
4. Local server: `node scripts/dev-local.mjs`, then open `http://localhost:3001` and sign in with the local demo accounts (development only).
5. Component gallery: `npm run dev --prefix client`, open `http://localhost:3000/#dev-gallery`.
6. Android: `node scripts/build-android.mjs local`, install `dist-android/*local*.apk` on an emulator with the local server running.
