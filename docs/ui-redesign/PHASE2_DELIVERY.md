# UI redesign Phase 2: Delivery Agent (local branch, not deployed)

Branch `ui-redesign-foundation`. Commits `c101aa4`, `d7aeed5`, `6d2fcd6`, `4f32d1a`. Nothing pushed, merged or deployed.

## What changed
- `client/src/delivery/`: `deliveryModel.js` (rules), `deliveryI18n.js` (English and Tamil), `useDeliveryRoute.js` (data and actions, same API and queue calls as before), `delivery.css`.
- `client/src/components/DeliveryRouteScreen.jsx`: rebuilt on the Phase 1 primitives; same name, page id and props. `DeliveryRouteMap.jsx`: the existing Leaflet map, moved out.
- Views: Today (progress, next actionable stop, counts, updates not accepted by the server, start route), All stops (search, filters), Map. Detail sheet with items, payment, reason/note, last update and 7-day shop history. Dialogs for pick up, delivery with full/part/no payment, and not delivered with the existing four reasons.
- Success is shown only after the server accepts an update; queued updates say "saved on this phone, waiting to sync"; refused updates say "not accepted by server" with the server's message.

## Android emulator walkthrough (23 Nov 2026)
Emulator `linecart_test` (Android 15, 1080x2400), local APK `in.linecart.suite.local` built at `4f32d1a`, local server only (`http://10.0.2.2:3001`, disposable SQLite), local demo Delivery Agent, test records labelled `UI-REDESIGN TEST`.

| Check | Result |
|---|---|
| Sign-in (interrupted earlier) | App was on the sign-in screen; nothing had been submitted. Signed in normally. |
| Today and next stop | Next actionable stop shown with one primary action; price-pending stop skipped as next. |
| Pick up | Confirmation dialog; hardware back closed it with no change; confirm updated the server. |
| Details and 7-day history | Owner, phone, address, no-GPS note, items with line totals, payment, last update, earlier order at the shop (Delivered, Partially collected). |
| Part payment and over-total | ₹5000 on a ₹923.5 order: error shown, Confirm disabled, with the numeric keyboard open the field, error and buttons stayed visible. ₹400: server recorded Partially collected, ₹523.5 balance; result dialog "Delivery confirmed by the server". |
| Not delivered | Reason "Wrong Address / Location Not Found" and a typed note; server recorded both. |
| All stops, search, filters | Search "Murugan" found both matching stops; Delivered, Not delivered, To pick up (includes price-pending) and Not synced filters correct; empty state shown. |
| Offline (airplane mode) | Offline banner; pick up and delivery saved locally with "Waiting to sync" chips, banner count and "saved on this phone" result. Never shown as delivered. |
| Reconnect | Queue sent automatically; list refreshed to server values; chips cleared. |
| Failed sync | Order finalised on the server from another session while the phone was offline: the queued delivery was refused; stop shows the server status plus "Not accepted by server" and the server's reason; "Not synced" filter lists it; top bar shows 1 alert. |
| Syncing | The transient "syncing" state was not caught on screen (the queue sent in under a second); it is covered by unit tests (`syncing` counts as pending). |
| Tamil | Area select, banners, tabs, labels and buttons in Tamil; long words wrap; no clipping or overflow. |
| Hardware back | Dialog → closes; sheet → closes; result dialog then sheet → close in order; keyboard → hides first; All stops / Map → Today (after fix); Today → app to background; relaunch resumes signed in. |
| Safe areas | Content stays between the status bar and gesture bar; bottom bar clear of the gesture area. |
| Delivery photos | Not applicable: the existing delivery screen never captured photos (photos exist only for sales visits). |

Screenshots are kept locally in the session scratch folder (not committed).

## Fixed during the walkthrough (`4f32d1a`)
- Back on the All stops or Map tab left the app; now returns to Today.
- A sign-in error from an earlier attempt stayed after a successful sign-in; errors are cleared on sign-in.
- The no-GPS navigation button wrapped to three lines; now "Navigate", with the address-only meaning in its accessible name.

## Backend finding (fixed after owner decision)
A delivery-status update for an order the office had already **cancelled** was accepted (local test order S203-24027: 'Cancelled' -> 'Picked up'). Fixed on this branch after the owner's decisions of 23 Nov 2026; see "Order status integrity" in `docs/IMPLEMENTATION_STATUS.md`. The local test record itself was left as it was.

## Tests and builds
- `npm test`: 28 of 28 suites, 357 of 357 tests.
- `npm run build --prefix client`: passes.
- Local APK built with `scripts/build-android.mjs local` and checked with `scripts/inspect-apk.mjs` (local backend only, no secrets).
