# LineCart 2.0 — Web, Laptop & Mobile Operations Suite

LineCart 2.0 is a field sales force automation, store onboarding, wholesale commodity order booking, and delivery fulfillment platform. Re-engineered from the legacy `linecart.apk` (`com.dalavai.linecart`), this application provides multi-tier role-based access control supporting **Administrators**, **Sales Managers**, **Field Sales Agents**, and **Delivery Agents**.

---

## 📚 Complete Documentation Suite

### 1. User Manual
- 📝 **[Editable Markdown](docs/USER_MANUAL.md)** | 📄 **[Download PDF](docs/pdf/LineCart_User_Manual.pdf)**
Practical, step-by-step operating instructions for all four user roles (Admin, Sales Manager, Field Sales Agent, and Delivery Agent), 10-digit Indian mobile authentication rules, mobile previews, accessible navigation, and operational troubleshooting.

### 2. Architecture & Workflow Guide
- 📝 **[Editable Markdown](docs/ARCHITECTURE_AND_WORKFLOW_GUIDE.md)** | 📄 **[Download PDF](docs/pdf/LineCart_Architecture_and_Workflow_Guide.pdf)**
Comprehensive technical architecture detailing frontend/backend design, SQL schema & transactions, Bearer token session security, Leaflet map engine with dual-tile resilience, OSRM road routing, and complete REST API directory.

### 3. Libraries & Technical Reference Guide
- 📝 **[Editable Markdown](docs/LIBRARIES_AND_TECHNICAL_GUIDE.md)** | 📄 **[Download PDF](docs/pdf/LineCart_Libraries_and_Technical_Guide.pdf)**
Complete catalog of installed runtime and development dependencies (`pg`, `express`, `multer`, `react`, `leaflet`), external web service providers (OpenStreetMap, CartoDB, OSRM), legacy APK compatibility notes, and staging/pilot deployment guide.

---

## ⚡ Quick Start & Prerequisites

### Prerequisites
- **Node.js**: v20.0.0 or higher (v22/v24 LTS recommended).
- **Database**: External PostgreSQL (`DATABASE_URL=postgresql://...`) for multi-instance staging/production, or zero-config durable WAL SQL database (`server/data/linecart.pg.db`) for single-node local/pilot deployments.

---

### Installation, Migration & Local Setup

1. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and set `INITIAL_ADMIN_PHONE` (a valid 10-digit Indian mobile number starting with 6–9) and a strong `INITIAL_ADMIN_PASSWORD`:
   ```bash
   cd linecart-suite
   cp .env.example .env
   ```

2. **Install Server Dependencies & Run Repeatable Migrations**:
   ```bash
   cd server
   npm install
   npm run migrate
   ```

3. **Install Client Dependencies & Build Frontend**:
   ```bash
   cd ../client
   npm install
   npm run build
   ```

4. **Start the Application Server**:
   ```bash
   cd ../server
   npm start
   ```

5. **Access in Browser**:
   Open **[http://localhost:3001](http://localhost:3001)**.

---

## 🔐 Authentication, Account Security & Role Landing Pages

- **Strict 10-Digit Indian Mobile Login**: Sign-in accepts **only** a registered 10-digit Indian mobile number beginning with `6`, `7`, `8`, or `9` (`/^[6-9]\d{9}$/`) plus the account password in the `POST /login` JSON request body. Usernames, country codes (`+91`), spaces, formatted numbers, and credentials in URL query parameters are strictly rejected (`400 Bad Request`).
- **First Administrator Setup**: Provisioned via `INITIAL_ADMIN_PHONE` and `INITIAL_ADMIN_PASSWORD` in `.env`, or via the one-time setup screen (`POST /api/system/setup-admin`) when no active Administrator has a configured password hash. Known demo/default passwords are rejected.
- **Rate Limiting & Session Revocation**: Failed sign-in attempts are rate-limited (`429 Too Many Requests` after 5 failed attempts within 15 minutes). Sessions are stored in the `sessions` SQL table (`SHA-256` token hash, 12-hour TTL) and immediately revoked on logout, deactivation, deletion, or role/password change.

| Role | Login Identifier Format | Default Landing Page | Primary Responsibilities |
| :--- | :--- | :--- | :--- |
| **Administrator** | 10-digit mobile (`6-9xxxxxxxxx`) | `/#admin-dashboard` | Full system governance, user provisioning, role permissions, manager-agent assignments, target quotas, audit trail. |
| **Sales Manager** | 10-digit mobile (`6-9xxxxxxxxx`) | `/#manager-reports` | Team performance tracking, target vs. achieved volume gap analysis, team orders inspection, cluster store coverage. |
| **Field Sales Agent** | 10-digit mobile (`6-9xxxxxxxxx`) | `/#overview` | Beat routes, wholesale commodity order booking, store onboarding with GPS & validated storefront photo capture. |
| **Delivery Agent** | 10-digit mobile (`6-9xxxxxxxxx`) | `/#delivery` | Mobile route map, road-distance sequencing, status progression (Picked Up / Delivered), issue reporting, bilingual audio assistance. |

---

## 🗄️ Database Migrations, Backups & Rollback

All business and administrative entities (`users`, `shops`, `orders`, `order_items`, `manager_assignments`, `sales_targets`, `role_permissions`, `audit_logs`, `app_settings`, `sessions`, `login_attempts`) are stored in the SQL database (`server/migrations/001_initial_schema.sql`).

```bash
# Run repeatable schema & seed migrations (preserves existing IDs and data)
npm --prefix server run migrate

# Create a full point-in-time JSON database snapshot in server/backups/
npm --prefix server run db:backup

# Restore / rollback the database transactionally from a snapshot file
node server/migrate.js --restore server/backups/<snapshot-file>.json
```

---

## 📱 Legacy Decompiled APK Compatibility & Capacitor Android Build

### Breaking Changes vs. Legacy `linecart.apk` (`com.dalavai.linecart`)
The original decompiled Android APK (`http://freshcubes.in/admin_panel/public/api/linecart/`) is **not directly compatible** without rebuilding from the updated client because:
1. The legacy APK sent `phone` and `password` in URL query parameters (`@POST("login") @Query("phone") @Query("password")`), which the hardened backend now rejects (`400 Bad Request`) to prevent credential exposure in URLs and logs.
2. The legacy APK did not attach `Authorization: Bearer <token>` headers on subsequent requests (`/gethomereport`, `/clusterinfo`, `/getitemsorder`, `/addcustomer`, `/createorder`), which now require authenticated session tokens (`401 Unauthorized`).

### Building the Hardened Android APK via Capacitor
Configuration templates are provided in `client/capacitor.config.json` and `client/android-config/` (`AndroidManifest.xml` with `usesCleartextTraffic="false"` and `network_security_config.xml`):
```powershell
cd client
$env:VITE_API_BASE_URL="https://staging.linecart.example.com"
npm run build
npx cap sync android
```

---

## 📂 Repository Structure

```
linecart-suite/
├── client/                     # React 18 + Vite Frontend Application
│   ├── android-config/         # Hardened AndroidManifest.xml & network_security_config.xml
│   ├── capacitor.config.json   # Capacitor Android HTTPS configuration
│   ├── dist/                   # Production compiled assets served by Express
│   └── src/                    # UI Components, Screens, API client, and CSS
├── server/                     # Node.js + Express Backend API & SQL Persistence
│   ├── migrations/             # SQL DDL schema migrations (001_initial_schema.sql)
│   ├── uploads/shops/          # Durable, magic-byte-validated shop photos (auth-gated)
│   ├── db.js                   # PostgreSQL (pg.Pool) & embedded WAL SQL adapter
│   ├── migrate.js              # Repeatable migration, phone audit, backup & restore CLI
│   └── index.js                # Hardened API server, auth middleware, and route handlers
├── docs/                       # Project Documentation & Generated PDFs
└── .env.example                # Staging & production environment template
```
