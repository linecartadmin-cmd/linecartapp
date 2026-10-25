# LineCart 2.0 — User Manual & Operations Guide

A comprehensive, role-by-role operating guide for LineCart 2.0 covering all operational workflows, permissions, and device experiences for **Administrators**, **Sales Managers**, **Field Sales Agents**, and **Delivery Agents**.

---

## Table of Contents

1. [System Access & Authentication](#1-system-access--authentication)
   - [Accessing LineCart](#accessing-linecart)
   - [Default & Development Credentials](#default--development-credentials)
   - [First-Time Login & Mandatory Password Change](#first-time-login--mandatory-password-change)
   - [Session Management & Global Logout](#session-management--global-logout)
   - [Accessible Back Navigation & Loop Prevention](#accessible-back-navigation--loop-prevention)
   - [Laptop View vs. Mobile Preview](#laptop-view-vs-mobile-preview)
2. [Role & Permission Overview](#2-role--permission-overview)
   - [Role Hierarchy & Security Scopes](#role-hierarchy--security-scopes)
   - [Permission Matrix](#permission-matrix)
3. [Administrator (Admin) Workflows](#3-administrator-admin-workflows)
   - [Executive Command Center (Dashboard)](#executive-command-center-dashboard)
   - [User Management (CRUD, Roles & Protection)](#user-management-crud-roles--protection)
   - [Manager-to-Agent Team Assignments](#manager-to-agent-team-assignments)
   - [Role Permissions Configuration](#role-permissions-configuration)
   - [Setting Sales Quotas & Commodity Targets](#setting-sales-quotas--commodity-targets)
   - [Audit Trail & Compliance Logs](#audit-trail--compliance-logs)
   - [System Settings & Branding](#system-settings--branding)
4. [Sales Manager Workflows](#4-sales-manager-workflows)
   - [Manager Performance Reports](#manager-performance-reports)
   - [Target vs. Achieved Analytics](#target-vs-achieved-analytics)
   - [Commodity Volume & Deficit Gap Tracking](#commodity-volume--deficit-gap-tracking)
   - [Team Orders Ledger & Order Verification](#team-orders-ledger--order-verification)
   - [Cluster Store Coverage Map & Spiderfying](#cluster-store-coverage-map--spiderfying)
   - [Supervised Team Roster](#supervised-team-roster)
5. [Field Sales Agent Workflows](#5-field-sales-agent-workflows)
   - [Agent Daily Route Overview](#agent-daily-route-overview)
   - [Booking Wholesale Commodity Orders](#booking-wholesale-commodity-orders)
   - [Onboarding New Retail Stores (GPS & Photos)](#onboarding-new-retail-stores-gps--photos)
   - [Order History & Status Tracking](#order-history--status-tracking)
6. [Delivery Agent Workflows](#6-delivery-agent-workflows)
   - [Touch-Optimized Mobile Interface](#touch-optimized-mobile-interface)
   - [Cluster Selection & Delivery Summary](#cluster-selection--delivery-summary)
   - [Road Routing & Map Navigation](#road-routing--map-navigation)
   - [Co-Located Stops & Radial Fan-Out Markers](#co-located-stops--radial-fan-out-markers)
   - [Advancing Order Status (Picked Up & Delivered)](#advancing-order-status-picked-up--delivered)
   - [Handling Delivery Issues (Could Not Deliver)](#handling-delivery-issues-could-not-deliver)
   - [Bilingual Toggle & Voice Assistant](#bilingual-toggle--voice-assistant)
7. [Order Lifecycle & Delivery Status Flow](#7-order-lifecycle--delivery-status-flow)
8. [Troubleshooting & Operational FAQ](#8-troubleshooting--operational-faq)

---

## 1. System Access & Authentication

### Accessing LineCart
LineCart is accessible through any modern desktop or mobile web browser at:
```
http://localhost:3001
```
For local network deployment, replace `localhost` with your host IP (e.g. `http://192.168.1.50:3001`).

### Default & Development Credentials
In local development (`NODE_ENV=development`), shortcut credentials and demo accounts are available:

| Role | Username / Phone | Password | Landing Page | Operational Scope |
| :--- | :--- | :--- | :--- | :--- |
| **Administrator** | `admin` *(or phone)* | `admin123` | `/#admin-dashboard` | Organization-wide administration, quotas, users, audit. |
| **Sales Manager** | `9876500001` | `password123` | `/#manager-reports` | Team analytics, quota tracking, assigned orders ledger. |
| **Field Sales Agent** | `9876543210` | `password123` | `/#overview` | Store onboarding, wholesale order booking, beat routes. |
| **Delivery Agent** | `9876500050` | `1234` | `/#delivery` | Delivery routes, stop sequencing, status advancement. |

> [!IMPORTANT]
> The development shortcut username `admin` is automatically disabled when `NODE_ENV=production`. In production, all users must authenticate with their registered 10-digit phone number.

### First-Time Login & Mandatory Password Change
When an account is flagged with `mustChangePassword: true` (newly created accounts or after an admin reset):
1. **Sign In**: Enter registered identifier and temporary password.
2. **Password Dialog**: The application immediately displays the **Password Change Required** modal.
3. **Password Rules**: Minimum 8 characters, containing at least one uppercase letter, one lowercase letter, and one number.
4. **Secure Update**: The backend verifies the temporary password, derives a new cryptographic hash using `scrypt` with a 16-byte random salt, clears the flag, and redirects the user to their role landing page.

### Session Management & Global Logout
- **Cryptographic Session Tokens**: Authenticated sessions generate a secure UUID token stored in `localStorage` under `LineCartPref_token`. All API requests carry this token in the `Authorization: Bearer <token>` header.
- **Authoritative Identity Sync**: On application load, the frontend validates the active token against `/api/auth/me`. The server determines user permissions and redirects them to their designated landing page.
- **Global Logout**:
  - **Desktop / Laptop View**: Click **Sign out** (`🚪 Sign out`) in the top navigation header.
  - **Mobile View / Preview**: Tap **Sign out** in the topbar or tap the **Sign out** tab in the mobile bottom navigation bar.
  - **Server Invalidation**: Logging out triggers `POST /api/auth/logout`, permanently destroying the server session token and clearing client storage.

### Accessible Back Navigation & Loop Prevention
- **Icon-Only Display**: The back button renders only a clean left arrow (`←`) without visible text.
- **Screen-Reader Accessibility**: Includes `aria-label="Go back"`, `title="Go back"`, and visually hidden text `<span className="sr-only">Go back</span>`.
- **Large Touch Target**: Sized to `38×38px` on desktop and expanded to `42×42px` on mobile screens to ensure easy tapping.
- **Loop Prevention**: Maintains an internal navigation stack. When users reach their role's home page, tapping Back remains safely on that home screen rather than causing redirect loops or accidental logouts.

### Laptop View vs. Mobile Preview
LineCart features an integrated device preview toggle in the top header (`💻 Laptop view` / `📱 Mobile preview`):
- **Laptop View**: Full-width desktop experience with side-by-side maps, multi-column forms, and detailed data tables.
- **Mobile Preview**: Emulates a real smartphone frame (`390×844px`) with responsive single-column layouts, large touch targets, and mobile bottom navigation.

---

## 2. Role & Permission Overview

LineCart enforces strict role-based access control across four distinct user roles:

```
+-----------------------------------------------------------------------------------+
|                           LINECART ROLE & PERMISSION MATRIX                       |
+---------------------+-------------------+-------------------+---------------------+
| ROLE                | LANDING PAGE      | DATA SCOPE        | KEY PERMISSIONS     |
+---------------------+-------------------+-------------------+---------------------+
| Administrator       | #admin-dashboard  | Organization-wide | All permissions     |
| Sales Manager       | #manager-reports  | Assigned Team     | Reports, Quotas     |
| Field Sales Agent   | #overview         | Personal Route    | Book, Onboard       |
| Delivery Agent      | #delivery         | Assigned Stops    | Route, Status       |
+---------------------+-------------------+-------------------+---------------------+
```

- **Administrator**: Unconstrained read and write access across all clusters, users, teams, and settings.
- **Sales Manager**: Read and write access strictly limited to field sales agents assigned to their team.
- **Field Sales Agent**: Operational access to book wholesale orders and register shops within their daily cluster.
- **Delivery Agent**: Execution access to view assigned delivery orders, sequence stops, and advance delivery statuses.

---

## 3. Administrator (Admin) Workflows

### Executive Command Center (Dashboard)
- **URL**: `/#admin-dashboard`
- **KPI Metrics**: Real-time total system revenue (₹), total orders booked, registered retail stores count, active clusters, and supervising managers.
- **Quick Links**: One-tap access to Users, Permissions, Team Assignments, Targets, Audit, and Settings.
- **Recent Audit Feed**: Live stream of the last 5 administrative events with timestamps and user attribution.

### User Management (CRUD, Roles & Protection)
- **URL**: `/#admin-users`
- **Filter & Search**: Filter by role (`admin`, `sales_manager`, `field_sales_agent`, `delivery_agent`) or search by name and phone.
- **Create User**: Click **+ Add User**, provide name, phone, initial role, cluster assignment, and temporary password.
- **Edit User**: Modify user attributes, change role, or toggle active/inactive status. Inactive accounts are immediately blocked from logging in.
- **Delete User**: Permanently removes user account, target quotas, and team mappings.
- **Safety Safeguard**: The system prevents an administrator from deleting their own active account, and permanently blocks deletion, demotion, or deactivation of the last active Administrator.

### Manager-to-Agent Team Assignments
- **URL**: `/#admin-assignments`
- Only administrators can assign field sales agents to sales managers.
- Select a manager, review their current team, and click **Assign to Manager** from the list of unassigned agents.
- Removing an agent immediately revokes the manager's visibility over that agent's orders and reports.

### Role Permissions Configuration
- **URL**: `/#admin-permissions`
- Manage action permissions (`view`, `create`, `edit`, `delete`, `export`, `assign`, `set_targets`) across screens.
- When updated, permissions are persisted to disk in `server/admin_config.json` and enforced by backend middleware.

### Setting Sales Quotas & Commodity Targets
- **URL**: `/#admin-targets`
- **Summary Cards**: Total Assigned Quota (₹), Achieved Sales (₹), Fulfillment Rate (%), and Covered Agents.
- **Set Target**: Click **+ Set New Target**, select agent, enter target period (`YYYY-MM`), set total monthly revenue target (₹), and allocate specific commodity volume quotas (e.g. Eggs in crates, Onions in kg).
- **Edit / Delete**: Adjust existing quotas or delete outdated targets.

### Audit Trail & Compliance Logs
- **URL**: `/#admin-audit`
- Chronological immutable log of system actions: `LOGIN_SUCCESS`, `USER_CREATED`, `USER_UPDATED`, `TEAM_ASSIGNMENT_CHANGED`, `TARGETS_UPDATED`, `PERMISSIONS_UPDATED`, `DELIVERY_STATUS_UPDATED`.
- Export logs to CSV for compliance audits.

### System Settings & Branding
- **URL**: `/#admin-settings`
- Manage organization name, support contact numbers, currency symbol (`₹`), default GST percentage (5%), and system feature flags.

---

## 4. Sales Manager Workflows

### Manager Performance Reports
- **URL**: `/#manager-reports`
- Default landing page for Sales Managers.
- Scoped strictly to Field Sales Agents assigned to this manager by an Administrator.

### Target vs. Achieved Analytics
- Filter performance by date range (Today, This Week, This Month, Custom) and specific team agent.
- Displays revenue target gauge, achieved sales total, percentage achieved, and remaining revenue deficit.

### Commodity Volume & Deficit Gap Tracking
Inspect volume quotas for key wholesale produce items:
- **Eggs**: Target crates vs achieved crates.
- **Onions**: Target kg vs achieved kg.
- **Potatoes / Tomatoes / Green Chillies**: Real-time volume metrics and monetary value gap.

### Team Orders Ledger & Order Verification
- **URL**: `/#manager-orders`
- View all wholesale orders submitted by supervised agents.
- Filter by status (`Pending`, `Confirmed`, `Delivered`, `Cancelled`).
- Click any order row to review line items, unit rates, calculated GST, customer contact, and delivery notes.

### Cluster Store Coverage Map & Spiderfying
- **URL**: `/#map`
- Visualizes customer stores across operational clusters.
- **Status Pins**: Green pins (`✓`) for stores that placed orders in the period; gray pins (`•`) for idle stores.
- **Spiderfying Overlapping Pins**: Click **Fan Out Pins on Map** (`🕸️`) to radially expand stores that share identical physical coordinates, revealing individual pins connected by dashed guide lines.
- **Store Details Tab**: Click any pin to open owner name, contact number, category, and order history.

### Supervised Team Roster
- **URL**: `/#manager-team`
- Displays active Field Sales Agents assigned to the manager, including phone numbers and orders booked today.

---

## 5. Field Sales Agent Workflows

### Agent Daily Route Overview
- **URL**: `/#overview`
- Daily dashboard displaying assigned cluster, target store visits, completed visits, and total sales booked today.

### Booking Wholesale Commodity Orders
- **URL**: `/#order-create`
1. **Select Retail Shop**: Pick customer store from assigned cluster.
2. **Add Items**: Select commodities (Eggs, Onions, Potatoes, Tomatoes, Chillies) and enter quantities.
3. **Review Calculations**: Automatically calculates line item totals, applies 5% GST, and updates delivery grand total.
4. **Payment Mode & Date**: Choose payment terms (Credit, Cash on Delivery, UPI) and promised delivery date.
5. **Confirm**: Submit order to generate unique Order ID.

### Onboarding New Retail Stores (GPS & Photos)
- **URL**: `/#shop-new`
1. **Store Details**: Enter store name, contact owner, and 10-digit mobile number.
2. **Location & GPS**: Select cluster, enter address, and tap **Capture GPS Coordinates** using the device geolocation sensor.
3. **Store Photo**: Upload or capture a storefront photo for driver route verification.
4. **Submit**: Registers store immediately in the cluster directory.

### Order History & Status Tracking
- **URL**: `/#orders`
- Track status of submitted orders (`Submitted` → `Dispatched` → `Delivered`).

---

## 6. Delivery Agent Workflows

### Touch-Optimized Mobile Interface
- **URL**: `/#delivery`
- High-contrast, mobile-first design with large touch targets (48px to 64px) and clear status icons.

### Cluster Selection & Delivery Summary
- Select delivery cluster (e.g. `📍 Pollachi and Udumalaipet`).
- Real-time KPI summary: Total Assigned Stops, Pending Stops, Delivered Stops, Delivery Issues.

### Road Routing & Map Navigation
- **Interactive Leaflet Map**: Displays color-coded numbered stops (Amber = Pending, Blue = Picked up, Green = Delivered, Red = Issue).
- **Dual-Tile Resilience**: Loads OpenStreetMap tiles with automatic fallback to CartoDB Voyager if OSM is unavailable.
- **Start Route**: Tap **🚚 Start route** to arrange stops in a road-distance-efficient order via the public OSRM road routing engine (with offline Nearest-Neighbor fallback).
- **Open Maps**: Tap **🗺️ Open Maps** to navigate via Google Maps.

### Co-Located Stops & Radial Fan-Out Markers
- When multiple shops share the same physical address, LineCart renders a central hub marker showing the total stops count.
- Stop pins radiate radially around the hub with dashed leader lines, keeping every delivery accessible.
- Stop cards display a `🏢 Shared Address` badge.

### Advancing Order Status (Picked Up & Delivered)
1. **Mark as Picked Up**: When loading goods at the hub, tap **📦 Mark as Picked Up**, verify shop name and order ID, and tap Confirm.
2. **Mark as Delivered**: Upon store delivery, tap **✅ Mark as Delivered**, verify order ID, and tap Confirm.
3. **Duplicate Protection**: Prevents duplicate submissions and rejects transitions out of sequence.

### Handling Delivery Issues (Could Not Deliver)
If delivery cannot be completed:
1. Tap **❌ Could not deliver**.
2. Select a reason: **Shop Closed**, **Owner Not Available**, **Order Cancelled / Rejected**, or **Wrong Address / Location Not Found**.
3. Confirm update. The status advances to `Delivery failed` and logs to the audit trail.

### Bilingual Toggle & Voice Assistant
- **Language Toggle**: Tap `🌐 தமிழ்` / `🌐 English` in the header to instantly switch all UI labels.
- **Voice Assistant**: Tap 🔊 on any stop card to have the browser speak stop instructions aloud.

---

## 7. Order Lifecycle & Delivery Status Flow

```
[Field Agent Books Order]
         │
         ▼
[Status: Pending / In Progress]
         │
         ▼
[Delivery Agent: Mark as Picked Up]
         │
         ▼
[Status: Picked Up (On Truck)]
         │
    ┌────┴──────────────────────────┐
    ▼                               ▼
[Delivered to Store]        [Delivery Issue Encountered]
    │                               │
    ▼                               ▼
[Status: Delivered]         [Status: Delivery Failed]
(Final Success)             (Saved with Reason)
```

---

## 8. Troubleshooting & Operational FAQ

### Blank Page or White Screen Recovery
- **React Error Boundary**: If an uncaught error occurs, LineCart displays a user-friendly error card with a **Reload Application** button instead of a blank page.
- **Hard Refresh**: Press `Ctrl + F5` (Windows) or `Cmd + Shift + R` (Mac) to bypass stale cached scripts.
- **Verify Server**: Confirm the server is running on port 3001:
  ```powershell
  Get-Process -Name node
  ```

### Server Port Conflict (Port 3001)
If you see `Error: listen EADDRINUSE :::3001`:
```powershell
Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object OwningProcess
Stop-Process -Id <OwningProcessId> -Force
```

### Access Denied: Administrator Role Required
If the dashboard displays an access denied warning:
1. Click **Sign In Again** or sign out via the topbar.
2. Log in freshly with your Administrator credentials.
3. The app synchronizes active session credentials with `/api/auth/me`.

### Data Reset on Server Restart
- **Administrative Records Persist**: Users, password hashes, targets, assignments, and audit logs are saved on disk in `server/admin_config.json` and persist across restarts.
- **Transactional Records Reset**: Submitted orders and newly onboarded stores reside in server memory and reset to baseline mock data (`data.js`) when the Node server restarts.
