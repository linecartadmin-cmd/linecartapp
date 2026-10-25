# LineCart 2.0 — Known Limitations, Client Compatibility & Pilot Readiness Guide

This document outlines the current persistence architecture, external service dependencies, legacy Android APK compatibility breaks, and staging requirements for a safe, limited LineCart pilot.

---

## 1. Data Storage & Persistence Model

All business, transactional, and administrative entities are persisted in the relational SQL database (`server/migrations/001_initial_schema.sql` via `server/db.js`), supporting external PostgreSQL (`DATABASE_URL=postgresql://...`) and local WAL SQL storage (`server/data/linecart.pg.db`).

| Data Type | Storage Table / Location | Survives Server Restart | Notes |
| :--- | :--- | :--- | :--- |
| **Users & Password Hashes** | `users` SQL table | ✅ **Persistent** | Unique 10-digit Indian mobile (`6-9xxxxxxxxx`) + `scrypt` hash |
| **Role Permissions Matrix** | `role_permissions` SQL table | ✅ **Persistent** | Immutable Admin guard enforced |
| **Manager-Agent Assignments** | `manager_assignments` SQL table | ✅ **Persistent** | Composite primary key `(manager_id, agent_id)` |
| **Sales Quotas & Item Targets** | `sales_targets` SQL table | ✅ **Persistent** | Scoped by agent, manager, cluster, and period |
| **Administrative Audit Logs** | `audit_logs` SQL table | ✅ **Persistent** | Indexed by timestamp and action |
| **System Settings** | `app_settings` SQL table | ✅ **Persistent** | Key-value JSON configuration |
| **Authenticated User Sessions** | `sessions` SQL table | ✅ **Persistent** | `SHA-256` token hash, 12-hour TTL, instant revocation |
| **Login Rate-Limit Ledger** | `login_attempts` SQL table | ✅ **Persistent** | Tracks failed attempts per mobile and IP |
| **Wholesale Commodity Orders** | `orders` & `order_items` SQL tables | ✅ **Persistent** | Transactional `serial_no` + `idempotency_key` deduplication |
| **Registered Retail Stores** | `shops` SQL table | ✅ **Persistent** | Preserves all 314 migrated shops + newly registered stores |
| **Storefront Photographs** | `server/uploads/shops/` + `shops.photo` | ✅ **Persistent** | Magic-byte validated (`JPEG`/`PNG`/`WebP`, <= 5 MB), served via authenticated `GET /api/uploads/shops/:filename` |

---

## 2. Legacy Decompiled APK Compatibility Break

The original decompiled Android APK (`com.dalavai.linecart` targeting `http://freshcubes.in/admin_panel/public/api/linecart/`) has two intentional security incompatibilities with the hardened backend:

1. **Credentials in URL Query Parameters Rejected (`400 Bad Request`)**:
   - The legacy APK's Retrofit `ApiService` declared `@POST("login") Call<LoginResponse> userLogin(@Query("phone") String phone, @Query("password") String password)`.
   - Passing credentials in URL query parameters exposes passwords in proxy logs and browser history. The backend now accepts credentials **only in the `POST /login` JSON request body** and rejects any `/login` request containing `phone` or `password` query parameters.
2. **Bearer Session Token Required on All Protected Routes (`401 Unauthorized`)**:
   - The legacy APK stored only `result[0].id` in `SharedPreferences("LineCartPref")` and passed `spersonId` in query strings without an `Authorization` header.
   - The hardened backend never trusts `X-User-Id`, `userid`, `spersonId`, or `managerId` as caller identity; every protected route requires `Authorization: Bearer <token>` and enforces ownership and role permissions (`401` / `403`).

**Resolution**: Build and distribute a fresh Android APK from the updated React client using Capacitor (`client/capacitor.config.json` and `client/android-config/`).

---

## 3. External Web Service Dependencies & Unimplemented Integrations

1. **OSRM Public Routing API (`router.project-osrm.org`)**
   - Used by `client/src/routing.js` for road-distance stop sequencing in the Delivery Agent screen.
   - Because the public OSRM demo server is rate-limited and has no SLA, the app automatically falls back to an offline Nearest-Neighbor coordinate heuristic with a clear warning banner when OSRM is unreachable.
2. **OpenStreetMap & CartoDB Raster Map Tiles**
   - Interactive maps load tiles from `tile.openstreetmap.org` and automatically switch to `basemaps.cartocdn.com` on tile error.
3. **Payment Gateway & SMS OTP**
   - Payment mode selection (`Cash` / `Credit`) records accounting terms only; no external payment gateway or SMS OTP provider is connected.
4. **Load & Concurrency Testing**
   - While PostgreSQL connection pooling (`pg.Pool`), SQL indexes, and transactional order generation are implemented, formal load testing against the target pilot volume (1,000 shops and 50 concurrent users) should be executed on the target staging hardware before full rollout.
