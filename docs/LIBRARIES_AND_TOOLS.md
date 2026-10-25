# LineCart 2.0 — Libraries and Tools Reference

This document details all installed software libraries, frameworks, runtime environments, and third-party external web services utilized in LineCart 2.0. All package names and exact versions are verified directly against the project package manifests (`client/package.json` and `server/package.json`).

---

## 1. Summary of Dependencies

| Tier | Name | Version Specifier | Exact Manifest Location | Category | Primary Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Frontend** | `react` | `^18.3.1` | `client/package.json` | Dependency | Core declarative UI component framework and state management. |
| **Frontend** | `react-dom` | `^18.3.1` | `client/package.json` | Dependency | React rendering layer for browser Document Object Model (DOM). |
| **Frontend** | `leaflet` | `^1.9.4` | `client/package.json` | Dependency | Interactive mapping engine for shop coverage and delivery routes. |
| **Frontend** | `lucide-react` | `^0.468.0` | `client/package.json` | Dependency | Lightweight icon set for buttons, cards, statuses, and navigation. |
| **Frontend** | `vite` | `^6.0.3` | `client/package.json` | DevDependency | Next-generation frontend build tool and local development server. |
| **Frontend** | `@vitejs/plugin-react` | `^4.3.4` | `client/package.json` | DevDependency | React plugin for Vite providing Fast Refresh and JSX transformation. |
| **Frontend** | `tailwindcss` | `^3.4.16` | `client/package.json` | DevDependency | Utility-first CSS styling framework. |
| **Frontend** | `postcss` | `^8.4.49` | `client/package.json` | DevDependency | CSS transformation pipeline tool required by TailwindCSS. |
| **Frontend** | `autoprefixer` | `^10.4.20` | `client/package.json` | DevDependency | PostCSS plugin parsing CSS rules to add vendor prefixes automatically. |
| **Backend** | `express` | `^4.21.1` | `server/package.json` | Dependency | Fast, minimalist HTTP web server and REST API framework for Node.js. |
| **Backend** | `cors` | `^2.8.5` | `server/package.json` | Dependency | Cross-Origin Resource Sharing middleware for client-server communication. |
| **Backend** | `multer` | `^1.4.5-lts.1` | `server/package.json` | Dependency | Multipart/form-data handler for store front photo file uploads. |
| **Backend** | `crypto` | Built-in (Node.js) | Standard Library | Built-in Engine | Secure password hashing (`scryptSync`) and random salt generation. |
| **Backend** | `fs` / `path` / `http` | Built-in (Node.js) | Standard Library | Built-in Engine | Disk I/O for `admin_config.json`, path resolutions, HTTP handling. |

---

## 2. Client-Side Libraries (Installed Dependencies)

### Core Runtime
- **React (`^18.3.1`) & React-DOM (`^18.3.1`)**
  - **Why used:** Provides reactive component lifecycle, hooks (`useState`, `useEffect`, `useMemo`, `useRef`), and dynamic rendering of role-based views.
  - **Usage in code:** Powers all screens (`App.jsx`, `DeliveryRouteScreen.jsx`, `AdminTargetsScreen.jsx`, `ShopMapScreen.jsx`, etc.).

- **Leaflet (`^1.9.4`)**
  - **Why used:** High-performance, mobile-friendly interactive mapping library.
  - **Usage in code:** 
    - In `ShopMapScreen.jsx`: Renders cluster shop locations with custom marker pins, visual filters (ordered vs. non-ordered), and spiderfy radial expansion for overlapping shop coordinates.
    - In `DeliveryRouteScreen.jsx`: Renders delivery stop markers, numbered route sequences, color-coded delivery status badges, connecting polylines, and radial fan-out for co-located stops at the same physical address.

- **Lucide React (`^0.468.0`)**
  - **Why used:** Clean, accessible SVG iconography with zero runtime overhead.
  - **Usage in code:** Provides icons across the UI including `<ArrowLeft />` (accessible Back navigation), `<ShoppingCart />`, `<Truck />`, `<CheckCircle />`, `<AlertCircle />`, `<Users />`, `<ShieldCheck />`, `<Target />`, `<LogOut />`, and `<Smartphone />`.

### Development & Build Tooling
- **Vite (`^6.0.3`) & `@vitejs/plugin-react` (`^4.3.4`)**
  - **Why used:** Provides near-instant local hot-module replacement (HMR) and compiles production static assets into `client/dist/` in under 2 seconds.
- **TailwindCSS (`^3.4.16`), PostCSS (`^8.4.49`), & Autoprefixer (`^10.4.20`)**
  - **Why used:** Generates utility classes for layout, responsive grid configurations (`grid-cols-12` on laptop vs `grid-cols-1` on mobile), spacing, and color themes, combined with custom design tokens in `reference-theme.css`.

---

## 3. Server-Side Libraries (Installed Dependencies)

- **Express (`^4.21.1`)**
  - **Why used:** Serves the RESTful JSON API on port `3001` and statically hosts the compiled production client bundle from `client/dist/`.
  - **Usage in code:** Houses route handlers in `server/index.js`, role-based access control middleware (`requireAdmin`, `authorizeManagerAccess`, `requireDeliveryAgent`), and authentication flows.

- **CORS (`^2.8.5`)**
  - **Why used:** Enables cross-origin requests between the development Vite server (port 5173) and the Express backend (port 3001).

- **Multer (`^1.4.5-lts.1`)**
  - **Why used:** Handles multipart file uploads when field agents onboard new retail stores with store-front photographs (`POST /addcustomer`). Uploads are stored locally in the `uploads/` directory.

- **Node.js Native Modules (`crypto`, `fs`, `path`, `http`)**
  - **`crypto`**: Implements key derivation via `crypto.scryptSync(password, salt, 64)` with 16-byte cryptographically secure random salts for persistent password security.
  - **`fs` & `path`**: Manages asynchronous and atomic writes to `server/admin_config.json` for persistent user configurations, targets, role permissions, and audit logs.

---

## 4. External Web Services (Non-Installed Network Providers)

The application communicates with several external web services over the network. These are **not** bundled npm packages and require outbound network access:

### 1. OpenStreetMap Tile Server
- **Service Endpoint:** `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- **Purpose:** Primary raster tile provider for interactive maps in `ShopMapScreen.jsx` and `DeliveryRouteScreen.jsx`.
- **Usage:** Leaflet requests standard 256×256 PNG map tiles as the user pans and zooms.
- **Attribution:** `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`.
- **Dependency Type:** External HTTP Tile Server.

### 2. CartoDB Voyager Tile Server (Automatic Zero-Downtime Fallback)
- **Service Endpoint:** `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png`
- **Purpose:** Automatic fallback basemap tile provider. If the primary OpenStreetMap tile server times out, fails, or experiences rate limits, the client dynamically switches to CartoDB Voyager tiles to guarantee map visibility.
- **Attribution:** `&copy; <a href="https://carto.com/">CARTO</a>`.
- **Dependency Type:** External HTTP Tile Server.

### 3. Open Source Routing Machine (OSRM) Public Routing API
- **Service Endpoint:** `https://router.project-osrm.org/route/v1/driving/{coordinates}?overview=full&geometries=geojson`
- **Purpose:** Public road-network routing engine used by `client/src/routing.js` to calculate realistic driving distances, optimize delivery stop sequences, and generate route polylines.
- **Fallback Mechanism:** If the public OSRM server is unreachable, rate-limited, or disabled, `routing.js` falls back to an internal Nearest-Neighbor heuristic using Haversine distance, clearly marked with a route disclaimer.
- **Dependency Type:** External HTTP REST Routing Service.

### 4. Google Maps External Link Fallback
- **Service Endpoint:** `https://www.google.com/maps/search/?api=1&query={coords_or_address}`
- **Purpose:** External redirection link for delivery agents tapping **"Open Maps"** to navigate directly in Google Maps on their phone or browser.
- **Dependency Type:** Outbound Navigation URL.

---

## 5. Development & Testing Tools

- **Node.js Test Runners (`scratch/*.js`)**
  - Pure Node.js test scripts executing authenticated HTTP requests, validating role access, session lifecycle, coordinate deduplication, routing fallbacks, and user management.
- **Vite CLI (`vite build`, `vite preview`)**
  - Used for compiling and previewing production web bundles.
