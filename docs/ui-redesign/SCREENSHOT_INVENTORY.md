# UI redesign screenshot inventory

Generated on 23 Nov 2026 from the files actually present on this machine and each capture's own `capture-report.json`. The images are not committed: `docs/screenshots/` is git-ignored because screenshots can contain account details.

How the images were made: local server only (`scripts/dev-local.mjs` with a disposable SQLite file), local development demo accounts, headless Microsoft Edge over the DevTools protocol, full-page PNG at 360 px (mobile emulation), 768 px and 1280 px. File name pattern: `<role>/<page id>-<width>.png`. Full-page images stitch the page at one viewport height, so fixed bars (sidebar, bottom bar) appear once at their viewport position.

"Capture status" comes from the capture report for that screen: whether the page showed the error boundary, threw a JavaScript exception, or scrolled sideways at any width. The sign-in screen is captured but not probed.

## Not captured (both sets)
- Dialogs, sheets and menus in open state (order detail, create user, delivery confirm and payment, visit check-in results, More sheet, profile menu). Their behaviour was checked interactively instead; see `PHASE1.md`.
- The sign-in screen's other states (saved accounts list, biometric prompt, first-admin setup).
- Native Android screens: the emulator checks used `adb` screen captures kept in a scratch folder, not in this inventory.
- The development-only component gallery and phone-preview frame.
- Any production data: none was used.
- Capture time: Phase 1 images were re-captured after the review fixes (touch targets, toast and back-button changes); the earlier Phase 1 set was replaced.


## Baseline (before Phase 1, commit bbe9feb)

Folder: `docs/screenshots/ui-redesign-baseline/` (git-ignored). Report: `capture-report.json` in that folder.

| Role | Screen (page id) | Title shown | 360 px | 768 px | 1280 px | Capture status |
|---|---|---|---|---|---|---|
| Signed out | login | — | yes | yes | yes | not probed (sign-in screen) |
| Admin | admin-dashboard | Executive Command Center | yes | yes | yes | ok |
| Admin | admin-users | User Accounts & Roles | yes | yes | yes | ok |
| Admin | admin-roles | Roles & Permissions | yes | yes | yes | ok |
| Admin | admin-assignments | Team Assignments | yes | yes | yes | ok |
| Admin | admin-targets | Targets & Quotas | yes | yes | yes | ok |
| Admin | orders | All Company Orders | yes | yes | yes | ok |
| Admin | price-requests | Overview | yes | yes | yes | ok |
| Admin | items | Items & Daily Pricing | yes | yes | yes | ok |
| Admin | reports | Executive Reports | yes | yes | yes | ok |
| Admin | map | Cluster Shop Map | yes | yes | yes | ok |
| Admin | field-visits | Overview | yes | yes | yes | ok |
| Admin | delivery | Delivery Route Fulfillment | yes | yes | yes | ok |
| Admin | customers | Customer Shops | yes | yes | yes | ok |
| Admin | admin-audit | Security Audit Trail | yes | yes | yes | ok |
| Admin | admin-settings | System Settings | yes | yes | yes | ok |
| Sales Manager | reports | Performance Reports | yes | yes | yes | ok |
| Sales Manager | orders | Team Orders | yes | yes | yes | ok |
| Sales Manager | price-requests | Overview | yes | yes | yes | ok |
| Sales Manager | items | Items & Daily Pricing | yes | yes | yes | ok |
| Sales Manager | map | Cluster Shop Map | yes | yes | yes | ok |
| Sales Manager | field-visits | Overview | yes | yes | yes | ok |
| Sales Manager | team | Sales Team Supervision | yes | yes | yes | ok |
| Sales Manager | customers | Customer Shops | yes | yes | yes | ok |
| Field Sales Agent | overview | Overview | yes | yes | yes | ok |
| Field Sales Agent | orders | Order entry | yes | yes | yes | ok |
| Field Sales Agent | visits | Overview | yes | yes | yes | ok |
| Field Sales Agent | reports | Reports | yes | yes | yes | ok |
| Field Sales Agent | customers | Customer Shops | yes | yes | yes | ok |
| Field Sales Agent | summary | Summary Report | yes | yes | yes | ok |
| Delivery Agent | delivery | Delivery Route Fulfillment | yes | yes | yes | ok |

93 of 93 expected images present. None missing. No capture failures recorded (no error boundary, JavaScript exception or horizontal overflow).

## Phase 1 after review fixes

Folder: `docs/screenshots/ui-redesign-phase1/` (git-ignored). Report: `capture-report.json` in that folder.

| Role | Screen (page id) | Title shown | 360 px | 768 px | 1280 px | Capture status |
|---|---|---|---|---|---|---|
| Signed out | login | — | yes | yes | yes | not probed (sign-in screen) |
| Admin | admin-dashboard | Overview | yes | yes | yes | ok |
| Admin | admin-users | Users | yes | yes | yes | ok |
| Admin | admin-roles | Roles & permissions | yes | yes | yes | ok |
| Admin | admin-assignments | Team assignments | yes | yes | yes | ok |
| Admin | admin-targets | Targets | yes | yes | yes | ok |
| Admin | orders | Orders | yes | yes | yes | ok |
| Admin | price-requests | Price approvals | yes | yes | yes | ok |
| Admin | items | Items & daily prices | yes | yes | yes | ok |
| Admin | reports | Reports | yes | yes | yes | ok |
| Admin | map | Shop map | yes | yes | yes | ok |
| Admin | field-visits | Field visits | yes | yes | yes | ok |
| Admin | delivery | Delivery fleet | yes | yes | yes | ok |
| Admin | customers | Shops | yes | yes | yes | ok |
| Admin | admin-audit | Audit log | yes | yes | yes | ok |
| Admin | admin-settings | Settings | yes | yes | yes | ok |
| Sales Manager | reports | Reports & performance | yes | yes | yes | ok |
| Sales Manager | orders | Team orders | yes | yes | yes | ok |
| Sales Manager | price-requests | Price approvals | yes | yes | yes | ok |
| Sales Manager | items | Items & daily prices | yes | yes | yes | ok |
| Sales Manager | map | Shop map | yes | yes | yes | ok |
| Sales Manager | field-visits | Field visits | yes | yes | yes | ok |
| Sales Manager | team | My sales team | yes | yes | yes | ok |
| Sales Manager | customers | Shops | yes | yes | yes | ok |
| Field Sales Agent | overview | Overview | yes | yes | yes | ok |
| Field Sales Agent | orders | New order | yes | yes | yes | ok |
| Field Sales Agent | visits | My visits | yes | yes | yes | ok |
| Field Sales Agent | reports | Reports | yes | yes | yes | ok |
| Field Sales Agent | customers | Shops | yes | yes | yes | ok |
| Field Sales Agent | summary | Summary report | yes | yes | yes | ok |
| Delivery Agent | delivery | Delivery route | yes | yes | yes | ok |

93 of 93 expected images present. None missing. No capture failures recorded (no error boundary, JavaScript exception or horizontal overflow).
