# LineCart 2.0 — Architecture & Workflow Technical Guide

A comprehensive technical reference detailing the software architecture, authentication lifecycle, role-based authorization guards, API specifications, mapping and routing subsystems, and persistence models of the LineCart 2.0 enterprise platform.

---

## Table of Contents

1. [Architectural Overview](#1-architectural-overview)
   - [High-Level System Design](#high-level-system-design)
   - [Request & Response Lifecycle](#request--response-lifecycle)
2. [Frontend Architecture](#2-frontend-architecture)
   - [Single-Page Application Structure](#single-page-application-structure)
   - [State Management & Session Sync](#state-management--session-sync)
   - [Responsive Layout & Device Previews](#responsive-layout--device-previews)
   - [Accessible Navigation Stack & Loop Prevention](#accessible-navigation-stack--loop-prevention)
3. [Backend Architecture](#3-backend-architecture)
   - [Express REST API & Static Hosting](#express-rest-api--static-hosting)
   - [Authentication & Session Engine](#authentication--session-engine)
   - [Cryptographic Password Security](#cryptographic-password-security)
   - [Role-Based Access Control Middleware](#role-based-access-control-middleware)
4. [Map & Routing Subsystems](#4-map--routing-subsystems)
   - [Resilient Dual-Tile Map Layer](#resilient-dual-tile-map-layer)
   - [Coordinate Deduplication & Radial Fan-Out](#coordinate-deduplication--radial-fan-out)
   - [OSRM Road Routing Engine & Offline Fallback](#osrm-road-routing-engine--offline-fallback)
5. [Complete REST API Directory](#5-complete-rest-api-directory)
   - [Authentication & Identity Endpoints](#authentication--identity-endpoints)
   - [Administrator Endpoints](#administrator-endpoints)
   - [Sales Manager Endpoints](#sales-manager-endpoints)
   - [Field Sales Agent Endpoints](#field-sales-agent-endpoints)
   - [Delivery Agent Endpoints](#delivery-agent-endpoints)
6. [Data Storage & Persistence Boundaries](#6-data-storage--persistence-boundaries)
   - [Hybrid Storage Model](#hybrid-storage-model)
   - [Server Restart Implications](#server-restart-implications)

---

## 1. Architectural Overview

### High-Level System Design

LineCart 2.0 separates concerns cleanly between a modern client single-page application and a secure Node.js Express backend API:

```
+-------------------------------------------------------------------------------+
|                                CLIENT LAYER                                    |
|  React 18 SPA · Vite 6 · TailwindCSS · Leaflet Maps · Lucide Icons            |
|  - Multi-Role Support: Admin, Sales Manager, Field Agent, Delivery Agent      |
|  - Responsive Layout: 12-Column Grid (Laptop) vs. Stacked Frame (Mobile)      |
|  - Resilient Maps: Dual-Tile OSM / CartoDB with Radial Pin Fan-Out            |
|  - Road Routing: OSRM Public Routing with Offline Haversine Heuristic Fallback|
+---------------------------------------+---------------------------------------+
                                        | HTTP / JSON (Port 3001)
                                        | Header: Authorization: Bearer <token>
+---------------------------------------v---------------------------------------+
|                                BACKEND LAYER                                  |
|  Node.js v18+ · Express 4.21 · Multer 1.4 · Static Production SPA Host        |
+-------------------+-------------------+-------------------+-------------------+
                    |                   |                   |
      +-------------v----+     +--------v---------+    +----v-------------+
      |  Security Guards |     | Business Logic   |    | Map & Routing    |
      | - requireAdmin   |     | - Quotas & Target|    | - Leaflet Tiles  |
      | - managerAuth    |     | - Audit Trail    |    |   OSM + CartoDB  |
      | - deliveryAuth   |     | - Role-Perms     |    | - OSRM Routing   |
      | - scrypt hashing |     | - Session Map    |    |   + NN Fallback  |
      +-------------+----+     +--------+---------+    +------------------+
                    |                   |
+-------------------v-------------------v---------------------------------------+
|                            DATA STORAGE LAYER                                 |
| - In-Memory State: active sessions (`sessions`), orders (`submittedOrders`)   |
| - Local JSON Config: `admin_config.json` (Users, Targets, Assignments, Audit)  |
| - Static Datasets: `data.js` (Baseline mock shops and commodity catalog)      |
| - Local Uploads: `uploads/` (Storefront verification photographs)             |
+-------------------------------------------------------------------------------+
```

### Request & Response Lifecycle
1. **Request Dispatch**: The React client issues asynchronous `fetch()` requests carrying the session token in the HTTP `Authorization: Bearer <token>` header.
2. **Reverse Proxy Normalization**: Legacy paths prefixed with `http://freshcubes.in` are normalized to root-relative routes in `server/index.js`.
3. **Identity Resolution**: `getCaller(req)` extracts the Bearer token, verifies it against the active `sessions` Map, and resolves the caller's authoritative user record.
4. **Middleware Enforcement**:
   - `requireAdmin`: Enforces `caller.role === 'admin'`.
   - `authorizeManagerAccess`: Enforces that managers only access data for their assigned agents.
   - `requireDeliveryAgent`: Enforces delivery ownership, preventing agents from altering unassigned deliveries.
   - `checkActionPermission`: Validates granular permission overrides configured in the permissions matrix.
5. **Execution & Mutator**: Modifies in-memory arrays and persists configuration updates to `admin_config.json`.
6. **Audit Logging**: Operations write structured entries with timestamp, actor ID, and change details to the security audit queue.

---

## 2. Frontend Architecture

### Single-Page Application Structure
- **Core Framework**: React 18 with Vite 6.
- **Entry Point**: `client/src/main.jsx` renders `<App />` within a top-level `<ErrorBoundary />`.
- **Component Inventory**:
  - `AdminDashboardScreen.jsx`: Organization-wide KPI metrics and audit stream.
  - `AdminUsersScreen.jsx`: User provisioning, role assignment, and deletion protection.
  - `AdminTargetsScreen.jsx`: Revenue quotas and commodity targets configuration.
  - `AdminRolesPermissionsScreen.jsx`: Dynamic action permissions grid.
  - `AdminAuditScreen.jsx` & `AdminSettingsScreen.jsx`: System compliance and branding.
  - `ManagerReportsScreen.jsx` & `ManagerOrdersScreen.jsx`: Scoped team analytics and orders.
  - `ShopMapScreen.jsx`: Interactive cluster store map with spiderfy radial pin expansion.
  - `DeliveryRouteScreen.jsx`: Mobile delivery workflow with road routing and voice prompts.
  - `OrderEntryScreen.jsx` & `OrderBooking.jsx`: Wholesale commodity catalog ordering.
  - `RegisterShop.jsx` & `CustomersScreen.jsx`: Store onboarding with GPS geolocation.

### State Management & Session Sync
The client avoids stale cached roles by validating session tokens on mount via `GET /api/auth/me`. The server returns the authoritative role and profile, ensuring that client permissions reflect server-side assignments immediately.

### Responsive Layout & Device Previews
- **Laptop View**: Full 12-column layout (`lg:grid-cols-12`) placing data panels, forms, and interactive maps side by side.
- **Mobile Preview**: Emulates a physical smartphone frame (`390×844px`) with a mobile header, responsive single-column stacked cards, large touch targets (48px to 64px), and role-specific bottom tab navigation.

### Accessible Navigation Stack & Loop Prevention
- The universal Back button renders an icon-only left arrow (`←`) with `aria-label="Go back"` and hidden `.sr-only` text.
- Sized to `38×38px` on desktop and expanded to `42×42px` on mobile viewports.
- Uses an internal history stack. When the user navigates back to their role's home page, further Back taps remain safely on that home screen without looping or triggering logout.

---

## 3. Backend Architecture

### Express REST API & Static Hosting
The Express application running on port `3001` serves both the JSON REST API and the production-compiled frontend assets from `client/dist/`.

### Authentication & Session Engine
Sessions are registered in an in-memory `sessions` Map upon successful login:
```javascript
sessions.set(sessionToken, {
  userId: user.id,
  user: user,
  createdAt: Date.now()
});
```
When a user logs out (`POST /api/auth/logout`), the token is deleted from the Map, immediately invalidating any subsequent requests carrying that token.

### Cryptographic Password Security
User passwords are encrypted using Node.js native `crypto.scryptSync`:
- **Salt Generation**: 16 cryptographically random bytes via `crypto.randomBytes(16)`.
- **Key Derivation**: `crypto.scryptSync(password, salt, 64)`.
- **Storage Format**: `scrypt:<salt>:<hash>`.
- **Validation**: Timing-safe equality verification via `crypto.timingSafeEqual` prevents timing attack vulnerabilities.

### Role-Based Access Control Middleware
- **`requireAdmin`**: Enforces strict administrator role verification.
- **`authorizeManagerAccess`**: Restricts managers to data belonging exclusively to their supervised team.
- **`requireDeliveryAgent`**: Protects `/api/delivery/*` routes, ensuring agents cannot alter orders assigned to other drivers.
- **Last Active Administrator Safeguard**: The system blocks deleting, demoting, or deactivating the last remaining active Administrator to prevent lockout.

---

## 4. Map & Routing Subsystems

### Resilient Dual-Tile Map Layer
In `ShopMapScreen.jsx` and `DeliveryRouteScreen.jsx`, maps use Leaflet with an automatic dual-tile resilience strategy:
1. **Primary Tile Provider**: OpenStreetMap (`tile.openstreetmap.org`).
2. **Fallback Tile Provider**: CartoDB Voyager (`basemaps.cartocdn.com`). If OSM fails or times out, the tile layer automatically switches to CartoDB tiles without interrupting the user.

### Coordinate Deduplication & Radial Fan-Out
When multiple shops share the same physical address:
1. Shops sharing coordinates within a ~20m threshold are grouped into a location hub.
2. A central hub marker renders the count of co-located stops.
3. Individual pins radiate outward in a circle with dashed guide lines:
   \[
   \theta_i = \frac{2\pi \cdot i}{N} - \frac{\pi}{2}
   \]
   \[
   \text{lat}_i = \text{lat}_{\text{base}} + r \cdot \cos(\theta_i), \quad \text{lng}_i = \text{lng}_{\text{base}} + \frac{r}{\cos(\text{lat}_{\text{base}} \cdot \frac{\pi}{180})} \cdot \sin(\theta_i)
   \]
   Where \(r \approx 0.00018^\circ\) (~20m). Every stop remains individually visible and inspectable.

### OSRM Road Routing Engine & Offline Fallback
In `client/src/routing.js`:
- **Primary Engine**: Public OSRM Road Routing API (`router.project-osrm.org`). Calculates road distances along streets and returns route polylines.
- **Offline Fallback Engine**: If OSRM is unreachable, an internal Nearest-Neighbor heuristic using Haversine distance sequences stops with an explicit disclaimer notice.

---

## 5. Complete REST API Directory

### Authentication & Identity Endpoints
- `GET /api/system/mode`: Returns environment mode (`development` vs `production`).
- `GET /api/demo-users`: List of demo accounts for dev testing (disabled in production).
- `POST /login` (Aliases: `/api/linecart/login`, `/admin_panel/public/api/linecart/login`): Authenticates credentials, creates session token, returns user profile and `mustChangePassword` status.
- `GET /api/auth/me`: Authenticates active Bearer token, returns authoritative user and role data.
- `POST /api/auth/logout`: Terminates active session token.
- `POST /api/auth/change-password`: Validates old password and sets new scrypt-hashed password.

### Administrator Endpoints
- `GET /api/admin/dashboard`: Organization-wide KPI metrics and recent audit events.
- `GET /api/admin/users`: List of all system users with role and cluster metadata.
- `POST /api/admin/users`: Provisions a new user account.
- `PUT /api/admin/users/:id`: Updates an existing user's name, role, phone, or password.
- `POST /api/admin/users/:id/status`: Toggles user account active/inactive status.
- `DELETE /api/admin/users/:id`: Deletes a user account with safety checks.
- `GET /api/admin/permissions`: Fetches role-action permissions matrix.
- `PUT /api/admin/permissions`: Updates role-action permissions matrix.
- `GET /api/admin/orders`: Organization-wide orders ledger.
- `GET /api/admin/reports`: Organization-wide revenue and performance reports.
- `GET /api/admin/targets`: Lists all configured sales revenue and commodity targets.
- `POST /api/admin/targets`: Creates or updates a sales revenue and commodity target quota.
- `DELETE /api/admin/targets/:id`: Deletes a target quota.
- `GET /api/admin/items`: Lists all commodity products available for quota allocation.
- `GET /api/admin/audit`: Administrative audit log trail.
- `GET /api/admin/settings`: System branding and operational settings.
- `PUT /api/admin/settings`: Updates system settings.

### Sales Manager Endpoints
- `GET /api/manager/assignments`: Lists manager-to-agent supervision mappings.
- `POST /api/manager/assignments`: Updates team assignments (Admin only).
- `GET /api/manager/orders`: Orders ledger scoped to the manager's assigned team.
- `GET /api/manager/reports`: Performance reports scoped to the manager's assigned team.
- `GET /api/manager/targets`: Targets scoped to the manager's assigned team.
- `POST /api/manager/targets`: Sets team target quotas.
- `GET /api/manager/shops`: Cluster shop map data with ordered vs. non-ordered counts and coordinate deduplication.

### Field Sales Agent Endpoints
- `GET /gethomereport`: Daily beat route summary, pending visits, and orders count.
- `GET /clusterinfo`: Clusters and retail store directory for the active beat route.
- `POST /addcustomer`: Onboards a retail customer store with GPS coordinates and storefront photo.
- `GET /getitemsorder`: Wholesale commodity catalog with unit rates and stock status.
- `POST /createorder`: Submits a wholesale commodity order.

### Delivery Agent Endpoints
- `GET /api/delivery/orders`: Returns orders assigned to the authenticated delivery agent, grouped by cluster. Supports optional `?clusterId=...` filter.
- `POST /api/delivery/orders/:id/status`: Advances delivery status (`Picked up` → `Delivered` or `Could not deliver` with failure reason).

---

## 6. Data Storage & Persistence Boundaries

### Hybrid Storage Model
LineCart 2.0 uses a hybrid storage model:
- **Persistent Disk Storage (`server/admin_config.json`)**: User accounts, password hashes, role permissions, manager assignments, targets, audit logs, and settings.
- **In-Memory RAM Storage (`submittedOrders` & `shops`)**: Customer orders and newly registered retail stores live in memory and reset to baseline seed data (`data.js`) when the Node.js server process restarts.
- **Session Tokens**: Active session tokens reside in server memory and are cleared upon server restart.
- **Local File Uploads (`server/uploads/`)**: Storefront verification photographs persist on the local filesystem.

### Server Restart Implications
When the server process restarts:
1. All administrative accounts, permissions, targets, and audit trails remain intact.
2. Orders and newly registered stores reset to the initial seed dataset.
3. Active users must sign in again as memory sessions are cleared.
