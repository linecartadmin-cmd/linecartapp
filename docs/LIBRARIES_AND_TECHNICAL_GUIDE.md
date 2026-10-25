# LineCart 2.0 — Libraries & Technical Reference Guide

A technical reference detailing all installed software libraries, frameworks, build tools, external web services, known limitations, and production readiness requirements for the LineCart 2.0 enterprise suite.

---

## Table of Contents

1. [Package Manifests & Dependency Inventory](#1-package-manifests--dependency-inventory)
   - [Frontend Dependencies (client/package.json)](#frontend-dependencies-clientpackagejson)
   - [Backend Dependencies (server/package.json)](#backend-dependencies-serverpackagejson)
2. [Installed Libraries & Usage in Code](#2-installed-libraries--usage-in-code)
   - [Frontend Runtime Libraries](#frontend-runtime-libraries)
   - [Frontend Build & Styling Tooling](#frontend-build--styling-tooling)
   - [Backend Runtime Libraries](#backend-runtime-libraries)
   - [Node.js Built-In Standard Modules](#nodejs-built-in-standard-modules)
3. [External Web Services (Non-Installed Providers)](#3-external-web-services-non-installed-providers)
   - [OpenStreetMap Tile Server](#openstreetmap-tile-server)
   - [CartoDB Voyager Tile Server](#cartodb-voyager-tile-server)
   - [OSRM Public Road Routing API](#osrm-public-road-routing-api)
   - [Google Maps External Navigation](#google-maps-external-navigation)
4. [Known Architectural Limitations](#4-known-architectural-limitations)
   - [In-Memory State & Reset Boundaries](#in-memory-state--reset-boundaries)
   - [Mocked & Incomplete Integrations](#mocked--incomplete-integrations)
   - [External Service Dependencies & Rate Limits](#external-service-dependencies--rate-limits)
5. [Production Deployment Checklist](#5-production-deployment-checklist)

---

## 1. Package Manifests & Dependency Inventory

### Frontend Dependencies (`client/package.json`)

```json
{
  "name": "linecart-client",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "leaflet": "^1.9.4",
    "lucide-react": "^0.468.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.16",
    "vite": "^6.0.3"
  }
}
```

### Backend Dependencies (`server/package.json`)

```json
{
  "name": "linecart-server",
  "version": "1.0.0",
  "main": "index.js",
  "type": "module",
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.1",
    "multer": "^1.4.5-lts.1"
  }
}
```

---

## 2. Installed Libraries & Usage in Code

### Frontend Runtime Libraries
- **`react` (`^18.3.1`) & `react-dom` (`^18.3.1`)**
  - Declarative UI component tree, hooks (`useState`, `useEffect`, `useMemo`, `useRef`), and DOM reconciliation.
  - Used across all screens (`App.jsx`, `DeliveryRouteScreen.jsx`, `AdminTargetsScreen.jsx`, `ShopMapScreen.jsx`).
- **`leaflet` (`^1.9.4`)**
  - High-performance mapping engine.
  - Renders store pins in `ShopMapScreen.jsx` and delivery routes, color-coded status badges, and radial fan-out markers in `DeliveryRouteScreen.jsx`.
- **`lucide-react` (`^0.468.0`)**
  - Accessible SVG icon library.
  - Provides icons throughout the app: `<ArrowLeft />` (accessible Back button), `<ShoppingCart />`, `<Truck />`, `<CheckCircle />`, `<AlertCircle />`, `<Users />`, `<Target />`, `<LogOut />`.

### Frontend Build & Styling Tooling
- **`vite` (`^6.0.3`) & `@vitejs/plugin-react` (`^4.3.4`)**
  - Lightning-fast dev server with HMR; builds production static bundles in `client/dist/` in under 2 seconds.
- **`tailwindcss` (`^3.4.16`), `postcss` (`^8.4.49`), & `autoprefixer` (`^10.4.20`)**
  - Utility-first CSS framework generating responsive grids (`grid-cols-12` on laptop vs `grid-cols-1` on mobile) and design system tokens.

### Backend Runtime Libraries
- **`express` (`^4.21.1`)**
  - HTTP web server and REST API framework hosting API routes on port 3001 and serving static production assets.
- **`cors` (`^2.8.5`)**
  - Cross-Origin Resource Sharing middleware enabling client-server communication during local development.
- **`multer` (`^1.4.5-lts.1`)**
  - Multipart/form-data middleware handling storefront photo file uploads (`POST /addcustomer`), stored in `server/uploads/`.

### Node.js Built-In Standard Modules
- **`crypto`**: Generates 16-byte random salts and computes password hashes via `crypto.scryptSync(password, salt, 64)`. Validates credentials with `crypto.timingSafeEqual`.
- **`fs` & `path`**: Handles atomic reads and writes to `server/admin_config.json`.

---

## 3. External Web Services (Non-Installed Providers)

The application communicates with several external web services over the network. These are **not** bundled npm packages and require outbound network connectivity:

### OpenStreetMap Tile Server
- **Endpoint**: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- **Purpose**: Primary raster tile provider for interactive maps in `ShopMapScreen.jsx` and `DeliveryRouteScreen.jsx`.
- **Attribution**: `&copy; OpenStreetMap contributors`.

### CartoDB Voyager Tile Server (Automatic Zero-Downtime Fallback)
- **Endpoint**: `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png`
- **Purpose**: Automatic fallback tile layer. If OpenStreetMap tiles fail or experience network timeouts, Leaflet automatically switches to CartoDB Voyager tiles to guarantee map visibility.
- **Attribution**: `&copy; CARTO`.

### OSRM Public Road Routing API
- **Endpoint**: `https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson`
- **Purpose**: Public routing engine used by `client/src/routing.js` to calculate road distances, sequence stops, and generate route polylines.
- **Fallback**: If OSRM is unreachable or rate-limited, `routing.js` falls back to an internal Nearest-Neighbor heuristic using Haversine distance, with a clear disclaimer notice.

### Google Maps External Navigation
- **Endpoint**: `https://www.google.com/maps/search/?api=1&query={coords_or_address}`
- **Purpose**: External redirection when a delivery driver taps **"Open Maps"** for turn-by-turn navigation.

---

## 4. Known Architectural Limitations

### In-Memory State & Reset Boundaries
LineCart currently operates on a hybrid storage architecture:

| Data Entity | Storage Location | State Across Server Restarts |
| :--- | :--- | :--- |
| **Users & Hashed Passwords** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) |
| **Role Permissions Matrix** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) |
| **Manager-Agent Assignments** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) |
| **Sales & Commodity Targets** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) |
| **Administrative Audit Logs** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) |
| **System Branding & Settings** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) |
| **Customer Wholesale Orders** | In-Memory Array (`submittedOrders`) | ❌ **Non-Persistent** (Resets to baseline) |
| **Newly Registered Shops** | In-Memory Array (`shops`) | ❌ **Non-Persistent** (Resets to baseline) |
| **Active Session Tokens** | In-Memory JavaScript `Map` | ❌ **Non-Persistent** (Cleared on restart) |
| **Storefront Photo Uploads** | Local Filesystem (`server/uploads/`) | ✅ **Persistent** (Saved to disk) |

### Mocked & Incomplete Integrations
1. **Payment Gateway**: Wholesale orders record payment terms (Credit, Cash, UPI) but do not connect to banking APIs (e.g. Razorpay, Stripe).
2. **Hardware GPS Geolocation**: The onboarding flow calls browser HTML5 Geolocation. If denied, it falls back to predefined cluster reference coordinates.
3. **SMS OTP Service**: Phone numbers serve as unique identifiers, but passwords are validated against stored hashes rather than live SMS OTP dispatch.
4. **Push Notifications**: Delivery assignments do not trigger native push notifications (FCM / APNs); agents pull assignments by refreshing the delivery screen.

### External Service Dependencies & Rate Limits
1. **Public OSRM API**: The public demo server is subject to throttling and rate limits. Production deployments should run a self-hosted OSRM Docker instance or integrate a commercial routing API (Mapbox, Google Directions).
2. **Public Map Tiles**: Free OSM and CartoDB tile servers are subject to fair-use policies.

---

## 5. Production Deployment Checklist

Before deploying LineCart 2.0 to a public or production environment:

- [ ] **Enforce `NODE_ENV=production`**: Disables the `admin`/`admin123` development shortcut.
- [ ] **Configure HTTPS / TLS Termination**: Terminate TLS via Nginx, Caddy, or AWS ALB.
- [ ] **Migrate to Relational Database**: Connect PostgreSQL or MySQL to persist orders, retail stores, and catalog data permanently with ACID transactions.
- [ ] **Clustered Session Store**: Migrate the in-memory `sessions` Map to Redis for multi-instance load balancing.
- [ ] **Restrict CORS Origins**: Replace `app.use(cors())` with an explicit domain whitelist.
- [ ] **Cloud Object Storage for Uploads**: Store uploaded shop photos in AWS S3 or Google Cloud Storage.
- [ ] **Self-Hosted Routing / Commercial API**: Replace the public OSRM demo endpoint with a self-hosted OSRM instance or commercial routing provider.
- [ ] **Rotate Default Credentials**: Immediately update all default administrative, manager, and driver passwords.
