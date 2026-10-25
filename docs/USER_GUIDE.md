# LineCart 2.0 — Comprehensive User Manual & Operations Guide

This guide provides practical, step-by-step operating instructions for all user roles in LineCart 2.0: **Administrator (Admin)**, **Sales Manager**, **Field Sales Agent**, and **Delivery Agent**. It covers standard workflows, operational responsibilities, security procedures, mobile previews, accessible navigation, and practical troubleshooting steps.

---

## Table of Contents

1. [System Access & Authentication](#1-system-access--authentication)
   - [Accessing the Application](#accessing-the-application)
   - [Default & Development Credentials](#default--development-credentials)
   - [First-Time Login & Mandatory Password Change](#first-time-login--mandatory-password-change)
   - [Session Management & Global Logout](#session-management--global-logout)
   - [Accessible Back Navigation & Loop Prevention](#accessible-back-navigation--loop-prevention)
   - [Device Previews: Laptop View vs. Mobile Preview](#device-previews-laptop-view-vs-mobile-preview)
2. [Administrator (Admin) Workflows](#2-administrator-admin-workflows)
   - [Admin Landing: Executive Dashboard](#admin-landing-executive-dashboard)
   - [User Management (CRUD, Roles & Activation)](#user-management-crud-roles--activation)
   - [Manager-to-Agent Team Assignments](#manager-to-agent-team-assignments)
   - [Role-Based Permissions Configuration](#role-based-permissions-configuration)
   - [Setting Revenue Quotas & Commodity Targets](#setting-revenue-quotas--commodity-targets)
   - [Audit Trail & Security Logs](#audit-trail--security-logs)
   - [System & Application Settings](#system--application-settings)
3. [Sales Manager Workflows](#3-sales-manager-workflows)
   - [Manager Landing: Performance Analytics](#manager-landing-performance-analytics)
   - [Target vs. Achieved Performance Analysis](#target-vs-achieved-performance-analysis)
   - [Commodity Volume & Target Gap Tracking](#commodity-volume--target-gap-tracking)
   - [Team Orders Ledger & Order Verification](#team-orders-ledger--order-verification)
   - [Cluster Store Coverage Map & Spiderfying](#cluster-store-coverage-map--spiderfying)
   - [Supervised Team Roster](#supervised-team-roster)
4. [Field Sales Agent Workflows](#4-field-sales-agent-workflows)
   - [Agent Landing: Daily Route Overview](#agent-landing-daily-route-overview)
   - [Booking Wholesale Commodity Orders](#booking-wholesale-commodity-orders)
   - [Onboarding New Retail Stores (GPS & Photos)](#onboarding-new-retail-stores-gps--photos)
   - [Order History & Status Tracking](#order-history--status-tracking)
5. [Delivery Agent Workflows](#5-delivery-agent-workflows)
   - [Delivery Agent Portal & Mobile Design](#delivery-agent-portal--mobile-design)
   - [Cluster Selection & Stop Overview](#cluster-selection--stop-overview)
   - [Road Routing & Map Navigation](#road-routing--map-navigation)
   - [Co-Located Stops & Radial Fan-Out Markers](#co-located-stops--radial-fan-out-markers)
   - [Step-by-Step Order Status Progression (Picked Up & Delivered)](#step-by-step-order-status-progression-picked-up--delivered)
   - [Handling Delivery Issues (Could Not Deliver)](#handling-delivery-issues-could-not-deliver)
   - [Bilingual Support & Voice Assistant](#bilingual-support--voice-assistant)
6. [Troubleshooting & Operational FAQ](#6-troubleshooting--operational-faq)
   - [Blank Page or Render Error Recovery](#blank-page-or-render-error-recovery)
   - [Server Port Conflicts (Port 3001)](#server-port-conflicts-port-3001)
   - [Authentication & Access Denied Errors](#authentication--access-denied-errors)
   - [Data Persistence Across Server Restarts](#data-persistence-across-server-restarts)

---

## 1. System Access & Authentication

### Accessing the Application

LineCart 2.0 is accessible through modern web browsers (Chrome, Edge, Firefox, Safari) at:
```
http://localhost:3001
```
For local network deployment, replace `localhost` with the server host IP (e.g., `http://192.168.1.50:3001`).

---

### Default & Development Credentials

> [!IMPORTANT]
> The temporary username `admin` with password `admin123` is enabled **only** when `NODE_ENV` is set to `development` (the default local configuration). When running in `NODE_ENV=production`, this development credential is strictly disabled by backend authorization rules.

| Role | Login Identifier | Default Password | Environment | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Administrator** | `admin` *(or phone)* | `admin123` | Development Only | Direct admin username bypass for local testing. |
| **Administrator** | `9999999999` *(example)* | Bootstrapped via `.env` | Production / Staging | Configured via `ADMIN_PHONE` and `ADMIN_PASSWORD` in `.env`. |
| **Sales Manager** | `9876500001` | `password123` | Demo / Test | Demo Sales Manager (Priya Sharma). |
| **Delivery Agent** | `9876500050` | `1234` | Demo / Test | Demo Delivery Agent (Murugan K - Pollachi Route). |
| **Field Sales Agent** | `9876543210` | `password123` | Demo / Test | Demo Field Agent (Ramesh Kumar - HSR Layout). |
| **Field Sales Agent** | `9876543211` | `password123` | Demo / Test | Demo Field Agent (Suresh Patel - Koramangala). |
| **Field Sales Agent** | `9876543212` | `password123` | Demo / Test | Demo Field Agent (Anil Verma - BTM Layout). |

---

### First-Time Login & Mandatory Password Change

When an account is flagged with `mustChangePassword: true` (such as newly provisioned accounts or reset accounts):

1. **Sign In**: Enter your phone number or identifier and temporary password on the login screen.
2. **Password Change Modal**: Upon verification, the application immediately displays the **Change Password Required** dialog before allowing navigation to any functional screens.
3. **Password Complexity Rules**:
   - Minimum length: **8 characters**.
   - Must contain at least **one uppercase letter** (`A-Z`).
   - Must contain at least **one lowercase letter** (`a-z`).
   - Must contain at least **one digit** (`0-9`).
   - Cannot match your existing temporary password.
4. **Confirmation**: Confirm the new password and click **Update Password**. The backend computes a fresh `scrypt` hash with a unique 16-byte cryptographic salt, clears `mustChangePassword`, and redirects you to your role landing page.

---

### Session Management & Global Logout

- **Session Persistence**: Sessions use cryptographically generated UUID tokens stored in browser `localStorage` under `LineCartPref_token` and `LineCartPref_user`. Requests send this credential via the standard `Authorization: Bearer <token>` header (as well as `X-User-Id`).
- **Authoritative Identity Verification**: On initial load or refresh, the frontend validates the active token against `/api/auth/me`. The server determines the user's role from active session state and redirects them to their designated landing page:
  - **Administrator**: `/#admin-dashboard`
  - **Sales Manager**: `/#manager-reports`
  - **Delivery Agent**: `/#delivery`
  - **Field Sales Agent**: `/#overview`
- **Global Logout**:
  - **Desktop / Laptop View**: Click the red **Sign out** button (`🚪 Sign out`) located in the top navigation header.
  - **Mobile Preview / Phone View**: Tap the **Sign out** button in the top bar or tap the **Sign out** icon tab in the bottom navigation bar.
  - **Session Invalidation**: Signing out triggers an authenticated `POST /api/auth/logout` request, immediately terminating the session token in the server's session registry, clearing browser storage, and returning to the sign-in screen.

---

### Accessible Back Navigation & Loop Prevention

The topbar and forms across all signed-in screens provide an accessible, icon-only **Back** button:
- **Icon-Only Display**: Displays a clean left-arrow icon (`←`) without visible text clutter.
- **Screen-Reader Accessibility**: Includes `aria-label="Go back"`, `title="Go back"`, and a hidden text span (`<span className="sr-only">Go back</span>`) for assistive devices.
- **Mobile Touch Sizing**: Styled to `38×38px` on desktop and expanded to `42×42px` on mobile viewports to provide a comfortable tap target.
- **Loop Prevention**: Maintains an in-app page history stack. When the user reaches their role's home page (or opens an un-nested link), pressing Back safely remains on the role home without trapping the user in infinite redirects or exiting the application prematurely.

---

### Device Previews: Laptop View vs. Mobile Preview

LineCart includes an integrated device toggle in the top header (`💻 Laptop view` / `📱 Mobile preview`):
- **Laptop View**: Utilizes full screen width, displaying rich data tables, multi-column forms, and side-by-side interactive maps.
- **Mobile Preview**: Emulates a physical smartphone frame (`390×844px` canvas) with mobile status bar, high-contrast buttons, and bottom tab navigation, allowing managers and administrators to test the mobile driver and field agent experiences directly on laptop displays.

---

## 2. Administrator (Admin) Workflows

The **Administrator** role provides full control over users, roles, team assignments, revenue targets, audit trails, and system settings.

### Admin Landing: Executive Dashboard
- **URL**: `http://localhost:3001/#admin-dashboard`
- **Primary Metrics**:
  - Total System Revenue (₹) aggregated across all finalized bookings.
  - Total Orders Booked and Total Active Retail Stores.
  - Active Clusters Count and Active Sales Managers Count.
- **Quick Action Grid**: One-click navigation to User Management, Role Permissions, Team Assignments, Targets, Audit Trail, and Settings.
- **Recent System Activity**: An audit feed displaying the 5 most recent administrative, security, and transaction events with timestamps and user attribution.

---

### User Management (CRUD, Roles & Activation)
- **URL**: `http://localhost:3001/#admin-users`
- **Listing & Filtering**:
  - Filter user accounts by role (`admin`, `sales_manager`, `field_sales_agent`, `delivery_agent`).
  - Search by Name, Phone Number, or Assigned Cluster.
- **Creating a New User**:
  1. Click the **+ Add User** button.
  2. Enter the user's Full Name, Phone Number (10 digits), and select their Primary Role.
  3. (Optional) Assign an initial cluster or territory.
  4. Specify an initial temporary password. The system automatically marks `mustChangePassword: true`.
  5. Click **Save User**. An audit log event (`USER_CREATED`) is written to `server/admin_config.json`.
- **Editing User Details**:
  - Click the **Edit** button beside any user row.
  - Modify the display name, assigned role, or cluster route.
  - Toggle account status between **Active** and **Inactive**. Inactive users are immediately rejected at login by backend authentication.
- **Deleting a User**:
  - Click the **Delete** button in the user row or within the Edit modal.
  - Confirm the permanent deletion prompt. The backend automatically cleans up their team mappings and assigned target quotas.
  - **Security Safeguards**:
    - Administrators cannot delete their own authenticated account.
    - The last active Administrator is permanently protected from deletion, demotion, or deactivation to prevent system lockout.
- **Forcing Password Reset**:
  - Enter a new password (min. 8 characters) in the Edit modal. The user will be required to change it upon their next sign-in.

---

### Manager-to-Agent Team Assignments
- **URL**: `http://localhost:3001/#admin-assignments`

> [!IMPORTANT]
> Sales Managers are strictly forbidden from assigning agents to themselves. Only administrators can alter manager-to-agent supervision structures.

1. **Select Manager**: Choose a Sales Manager from the dropdown list.
2. **Review Current Team**: The table displays all currently assigned Field Sales Agents, their phone numbers, and primary clusters.
3. **Assign New Agent**:
   - In the "Available Unassigned Agents" section, locate the target field agent.
   - Click **Assign to Manager**.
   - The backend updates the mapping in `admin_config.json` and logs the assignment event.
4. **Unassign Agent**:
   - Click the **Remove / Unassign** button next to an assigned agent.
   - The agent is immediately unlinked; the manager will no longer see this agent's orders, performance, or customer visits.

---

### Role-Based Permissions Configuration
- **URL**: `http://localhost:3001/#admin-permissions`
- **Matrix Configuration**:
  - View permissions across actions: `view`, `create`, `edit`, `delete`, `export`, `assign`, `set_targets`.
  - View permissions across screens: `dashboard`, `reports`, `orders`, `shops`, `team`, `users`, `permissions`, `targets`, `audit_logs`, `settings`.
- **Enforcement Mechanics**:
  - **Backend API Rules**: When an admin toggles a permission switch, the backend saves this in `admin_config.json`. Any subsequent API call without the required permission returns `403 Forbidden`.
  - **Frontend Adaptation**: The user interface hides action buttons and navigation links dynamically based on the permissions returned by `/api/role-permissions`.

---

### Setting Revenue Quotas & Commodity Targets
- **URL**: `http://localhost:3001/#admin-targets`
- **Executive Summary Dashboard**:
  - **Total Quota Assigned**: Aggregated quota in ₹ for the selected filter and period.
  - **Achieved Sales**: Real-time sales transactions achieved by target agents.
  - **Overall Fulfillment Rate**: Computed achievement percentage with visual status indicator.
  - **Covered Agents**: Count of active field agents with configured targets.
- **Filter Controls**:
  - Filter by Target Cycle / Period (e.g. `2026-10`, `2026-11`, `2026-12`, All Cycles).
  - Filter by Wholesale Cluster route and Supervising Manager.
  - Real-time search across agent names, phone numbers, and IDs.
- **Configuring a New Target**:
  1. Click **+ Set New Target**.
  2. Select the Field Sales Agent from the dropdown. The supervising manager and cluster route are automatically detected.
  3. Enter the Target Period (`YYYY-MM`) and Total Monthly Target Amount (₹).
  4. (Optional) Click **+ Add Commodity** to allocate specific commodity item volume quotas (e.g., Onion Medium, Potato, Tomato, Green Chilli) with target kg quantities and values.
  5. Click **Save Target Quota**. The quota is recorded immediately in `admin_config.json` and logged in the Security Audit Trail.
- **Editing & Deleting Targets**:
  - Click **Edit** beside any target row to adjust quota amounts or item targets.
  - Click **Delete** to permanently remove a quota record. Real order transactions remain unaffected.

---

### Audit Trail & Security Logs
- **URL**: `http://localhost:3001/#admin-audit`
- **Log Inspection**:
  - Chronological table showing Timestamp, Actor Name, Role, Action Type, Target Resource, IP Address, and Detailed Change Payload.
  - Event categories captured: `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `PASSWORD_CHANGED`, `USER_CREATED`, `USER_UPDATED`, `TEAM_ASSIGNMENT_CHANGED`, `TARGETS_UPDATED`, `PERMISSIONS_UPDATED`, `SETTINGS_SAVED`, `DELIVERY_STATUS_UPDATED`.
- **Exporting**: Click **Export Audit Trail (CSV)** to download an immutable audit record for compliance reviews.

---

### System & Application Settings
- **URL**: `http://localhost:3001/#admin-settings`
- **Configurable Options**:
  - Company Legal Entity Name and Brand Display Name.
  - Currency Symbol and Default Number Formatting (`INR / ₹`).
  - Standard GST / Tax Percentage (default: 5% on applicable wholesale lines).
  - Help Desk Phone Number and Support Email.
  - System Feature Flags (e.g., enable/disable camera uploads, toggle offline mode caching).

---

## 3. Sales Manager Workflows

The **Sales Manager** oversees an assigned team of Field Sales Agents. Managers track performance against quotas, monitor store visits, verify wholesale commodity bookings, and review cluster market penetration.

### Manager Landing: Performance Analytics
- **URL**: `http://localhost:3001/#manager-reports`
- **Default View**: Upon signing in, the Sales Manager is greeted directly with the **Performance Reports** dashboard.
- **Team-Scoped Visibility**: A manager **only** sees data corresponding to agents explicitly assigned to them by an Administrator. Data belonging to unassigned agents or other managers is filtered out on the server.

---

### Target vs. Achieved Performance Analysis
- **Filter Controls**:
  - **Date Range**: Today, Yesterday, This Week, This Month, or Custom Date Picker.
  - **Agent Selector**: "All Assigned Agents" (aggregated view) or select a specific agent.
  - **Cluster Filter**: Filter orders and shops by operational cluster (e.g., Pollachi, Udumalaipet).
- **Comparison Visualizations**:
  - **Revenue Bar / Progress Gauge**: Shows Total Target (₹) vs. Achieved Revenue (₹).
  - **Achievement Percentage**: Calculated as `(Achieved / Target) * 100`.
  - **Target Gap (₹)**: Displays the exact monetary deficit remaining to hit the quota.

---

### Commodity Volume & Target Gap Tracking
LineCart tracks wholesale agricultural commodities individually:

| Item / Commodity | Unit | Target Volume | Achieved Volume | Volume Gap | Target Value (₹) | Achieved Value (₹) | Value Gap (₹) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Eggs (30/Crate)** | Crates | 200 | 145 | -55 Crates | ₹24,000 | ₹17,400 | -₹6,600 |
| **Onions (Grade A)** | Kg | 1,500 | 1,220 | -280 Kg | ₹52,500 | ₹42,700 | -₹9,800 |
| **Potatoes** | Kg | 1,200 | 1,250 | **Met (+50)** | ₹36,000 | ₹37,500 | **+₹1,500** |
| **Tomatoes** | Crates | 150 | 95 | -55 Crates | ₹30,000 | ₹19,000 | -₹11,000 |
| **Green Chillies**| Kg | 300 | 210 | -90 Kg | ₹18,000 | ₹12,600 | -₹5,400 |

Managers use this breakdown to guide agents on which specific commodities to prioritize during store visits.

---

### Team Orders Ledger & Order Verification
- **URL**: `http://localhost:3001/#manager-orders`
- **Features**:
  - Comprehensive ledger of all orders booked by the manager's assigned agents.
  - Status filters: `Pending`, `Confirmed`, `Delivered`, `Cancelled`.
  - Click on any order row to inspect itemized line items, unit rates, calculated GST, customer contact, and delivery notes.

---

### Cluster Store Coverage Map & Spiderfying
- **URL**: `http://localhost:3001/#map`
- **Role-Based Scoping**:
  - **Administrator**: Organization-wide visibility across all clusters and agents, with an optional Manager filter to inspect individual teams.
  - **Sales Manager**: Strictly scoped to assigned team agents and their customer bookings.
- **Store Status Indicators & Visual Badges**:
  - **Green Pin (`✓`)**: Store placed at least one confirmed order in the filter period.
  - **Gray Pin (`•`)**: Idle store with zero orders recorded in the period.
  - **Shared Location Hub Pins (`N`)**: Stores located within the same commercial complex, bazaar, or street address that share identical GPS coordinates are aggregated into a numbered hub pin showing the count of shops.
- **Overlapping Pin Discovery & Spiderfying**:
  - **Spiderfy / Fan-Out (`🕸️`)**: Click **Fan Out Pins on Map** to radiate overlapping markers in a geometric circle around the center hub with dashed guide lines, enabling individual inspection of each store pin on the canvas. Click **Collapse** to return to the group hub.
  - **Location Store Tabs**: The bottom inspection card includes tab buttons to seamlessly cycle through all stores sharing that location.

---

### Supervised Team Roster
- **URL**: `http://localhost:3001/#manager-team`
- Displays the read-only roster of Field Sales Agents currently assigned to this manager.
- Shows agent phone numbers, active status, and order counts for today.
- *Note: To add or remove agents from this roster, contact an Administrator.*

---

## 4. Field Sales Agent Workflows

The **Field Sales Agent** works on the ground, visiting Kirana stores, supermarkets, and wholesale buyers. Key responsibilities are onboarding new stores and booking wholesale orders.

### Agent Landing: Daily Route Overview
- **URL**: `http://localhost:3001/#overview`
- **Daily Dashboard**:
  - Assigned cluster for today's beat.
  - Target store visits vs. completed visits.
  - Running total of daily sales value booked today.

---

### Booking Wholesale Commodity Orders
- **URL**: `http://localhost:3001/#order-create` (or click **+ New Order** from store card)
1. **Select Retail Store**: Search and pick the customer shop from your assigned cluster list.
2. **Add Products**:
   - Select commodity lines: Eggs, Onions, Potatoes, Tomatoes, Chillies.
   - Enter quantity in standard wholesale units (Crates, Bags, or Kg).
   - Real-time calculations: The screen automatically computes line totals, applies commodity tax (5% GST where applicable), and displays the grand total.
3. **Delivery Date & Payment Mode**: Select promised delivery date and payment method (Cash on Delivery, UPI, or Credit Terms).
4. **Submit Order**: Click **Confirm & Book Order**. A confirmation modal displays the generated Order ID (e.g., `ORD-20261025-XXXX`).

---

### Onboarding New Retail Stores (GPS & Photos)
- **URL**: `http://localhost:3001/#shop-new` (or click **+ Add Store**)
1. **Store Details**: Enter Store Name, Owner / Contact Name, and 10-digit Mobile Number.
2. **Location & Address**:
   - Enter street address, landmark, and select cluster.
   - Click **Capture GPS Coordinates** to save accurate latitude/longitude coordinates via the browser geolocation API.
3. **Business Classification**: Select store category (Kirana, General Store, Supermarket, Restaurant).
4. **GSTIN / Tax ID**: (Optional) Enter the customer's 15-character GSTIN.
5. **Shop Front Photo**: Upload or capture a storefront photo for route verification.
6. **Submit**: Click **Register Store**. The store is added to the cluster roster immediately.

---

### Order History & Status Tracking
- **URL**: `http://localhost:3001/#orders`
- View all orders submitted by your account.
- Check fulfillment status (`Submitted`, `Dispatched`, `Delivered`).
- Inspect itemized breakdown and delivery instructions.

---

## 5. Delivery Agent Workflows

The **Delivery Agent** portal (`#delivery`) is specifically tailored for phone usage, featuring a mobile-first, high-contrast, touch-optimized interface designed for drivers who may find long text difficult:
- **Large Touch Targets**: Action buttons have minimum heights of 48px to 64px with generous tap areas.
- **Clear Universal Icons**: Uses intuitive visual symbols (📦 Box/Pickup, 🚚 Van/Transit, ✅ Delivered, ❌ Issue/Failure, 📞 Call Shop, 🗺️ Map).
- **Spoken Audio Assistant**: Tapping the 🔊 icon next to any stop reads out the shop name, address, and current action aloud.
- **Bilingual English / தமிழ் (Tamil) Toggle**: Tap the `🌐 தமிழ்` / `🌐 English` toggle in the top header to instantly switch all labels and audio prompts.

---

### Cluster Selection & Stop Overview
1. **Sign In**: Enter your registered phone number (e.g., `9876500050`) and password (`1234`). You are directed to `/#delivery`.
2. **Select Delivery Area (Cluster)**:
   - Tap your assigned area button at the top (e.g., `📍 Pollachi and Udumalaipet`).
   - The KPI summary displays Total Stops, Pending, Delivered, and Delivery Issues.

---

### Road Routing & Map Navigation
- **Interactive Leaflet Map**:
  - Displays color-coded numbered stop pins:
    - 🟡 **Amber**: Pending / In progress.
    - 🔵 **Blue**: Picked up (on the delivery truck).
    - 🟢 **Green**: Delivered successfully.
    - 🔴 **Red**: Delivery issue / could not deliver.
  - **Tile Resilience**: Automatically loads OpenStreetMap tiles with an automatic zero-downtime fallback to CartoDB Voyager tiles.
- **Start Route (OSRM Road Routing)**:
  - Tap the prominent **🚚 Start route** button.
  - Stops are ordered in a road-distance-efficient sequence using the public OSRM road routing engine along real streets. If the routing service is unavailable, an offline Nearest-Neighbor heuristic sequence is provided with a clear disclaimer.
  - The first active stop is marked with a pulsing blue border and **⭐ NEXT STOP** badge.
- **Open Maps Navigation**:
  - Tapping **🗺️ Open Maps** launches Google Maps with exact coordinates (or address fallback) for turn-by-turn turn navigation.

---

### Co-Located Stops & Radial Fan-Out Markers
When multiple assigned customer shops share identical or co-located GPS coordinates (such as several vendors in the same market or complex):
1. **Central Hub Marker**: The map displays a central numbered hub pin indicating how many stops share that location.
2. **Radial Fan-Out**: Individual stop pins radiate outward in a neat circular fan-out with dashed leader lines connecting them to the center hub. Every stop marker remains individually visible, clickable, and inspectable.
3. **Shared Address Badge**: Stop cards in the delivery list display a `🏢 Shared Address (N stops at this address)` badge so drivers know in advance they have multiple deliveries at one stop.

---

### Step-by-Step Order Status Progression (Picked Up & Delivered)

1. **Step 1: Mark as Picked Up**
   - When loading wholesale produce at the distribution hub, tap **📦 Mark as Picked Up**.
   - A confirmation dialog clearly identifies the shop name and order ID. Tap **Confirm** to advance the order to *Picked up*.
2. **Step 2: Mark as Delivered**
   - Upon arriving at the shop, tap the prominent green **✅ Mark as Delivered** button.
   - The confirmation sheet displays the store name and order ID. Tap **Confirm Update**.
   - The status updates immediately in the persistent backend store, the stop card turns green, and a success voice confirmation is spoken aloud.
   - **Protection against duplicates**: Tapping an already delivered order displays a friendly notice and prevents duplicate API calls.

---

### Handling Delivery Issues (Could Not Deliver)

If delivery cannot be completed:
1. Tap **❌ Could not deliver**.
2. Select one of the clear reason options:
   - 🔒 **Shop Closed** (கடை மூடப்பட்டுள்ளது)
   - 👤 **Owner Not Available** (உரிமையாளர் இல்லை)
   - 🚫 **Order Cancelled / Rejected** (ஆர்டர் ரத்து)
   - 📍 **Wrong Address / Location Not Found** (தவறான முகவரி)
3. (Optional) Enter short notes and tap **Confirm Not Delivered**.
4. The stop status is updated to `Delivery failed`, saved to the backend database, and recorded in the administrative audit log.

---

### Bilingual Support & Voice Assistant

- **One-Tap Language Toggle**: Switch between **English** and **தமிழ் (Tamil)** at any time using the `🌐` button in the header.
- **Text-to-Speech Assistant**: Tapping the 🔊 icon triggers the browser's native Web Speech Synthesis API (`window.speechSynthesis`) to pronounce stop details in the active language.

---

## 6. Troubleshooting & Operational FAQ

### Blank Page or Render Error Recovery

#### Root Cause & Fix
In earlier builds, undefined variable references or unhandled null responses could lead to an unhandled React error. This has been resolved with:
1. **React Error Boundary**: A top-level [`ErrorBoundary`](file:///c:/Users/samma/Desktop/rea/linecart-suite/client/src/components/ErrorBoundary.jsx) wraps all route views. If any screen encounters an unexpected error, a clean recovery card is displayed with a **Reload Application** button instead of a white screen.
2. **Explicit Fallback States**: Loading skeletons and error cards render when network APIs are in-flight or return errors.

#### Troubleshooting Steps
1. Open Developer Tools (`F12` or `Ctrl + Shift + I`).
2. Hard-refresh the browser cache: press `Ctrl + F5` (Windows) or `Cmd + Shift + R` (macOS).
3. Verify the server is running on port 3001:
   ```powershell
   Get-Process -Name node
   ```

---

### Server Port Conflicts (Port 3001)

If you see `Error: listen EADDRINUSE: address already in use :::3001`:
1. Terminate the blocking process:
   ```powershell
   Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object OwningProcess
   Stop-Process -Id <OwningProcessId> -Force
   ```
2. Or start on a different port:
   ```powershell
   $env:PORT="3002"
   node server/index.js
   ```

---

### Authentication & Access Denied Errors

- **Issue**: "Access Denied: Administrator role required" error.
  - *Cause*: Stale browser storage or missing Bearer token in the request.
  - *Resolution*: Click **Sign In Again** or sign out. Log in freshly with your Administrator credentials. The frontend syncs your authoritative identity with `/api/auth/me`.
- **Issue**: Dev login `admin` / `admin123` fails.
  - *Cause*: `NODE_ENV` is set to `production`.
  - *Resolution*: Set `$env:NODE_ENV="development"` for local testing or use your registered 10-digit administrator phone number.

---

### Data Persistence Across Server Restarts

> [!WARNING]
> LineCart 2.0 uses a hybrid storage model:
> - **Persistent Disk Storage (`server/admin_config.json`)**: User accounts, password hashes, role permissions, manager-to-agent assignments, target quotas, audit logs, and settings persist across restarts.
> - **In-Memory RAM Storage (`submittedOrders` & `shops`)**: Submitted customer orders and newly onboarded retail stores reside in server memory and reset to baseline seed data (`data.js`) when the Node.js server process is restarted.
> 
> *For production deployments, an enterprise database engine (PostgreSQL or MongoDB) must be connected to persist transactional orders and customer store tables permanently.*
