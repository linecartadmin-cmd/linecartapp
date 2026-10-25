# LineCart 2.0 — Known Limitations & Production Readiness Guide

This document transparently outlines the known architectural limitations, in-memory state boundaries, external service dependencies, and prerequisites required prior to deploying LineCart 2.0 to a production environment.

---

## 1. Data Storage & Persistence Boundaries

The current application operates on a hybrid storage model:

| Data Type | Current Storage Mechanism | Persistence Across Server Restart | Production Recommendation |
| :--- | :--- | :--- | :--- |
| **Administrative Users & Passwords** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) | Relational Database (PostgreSQL / MySQL) |
| **Role-Based Permissions Matrix** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) | Database Table or Identity Provider |
| **Manager-Agent Assignments** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) | Relational Foreign Keys |
| **Sales Revenue & Volume Targets** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) | Relational Quotas Table |
| **Administrative Audit Logs** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) | Dedicated Log Store / Audit DB |
| **System Settings** | `server/admin_config.json` | ✅ **Persistent** (Saved to disk) | Application Environment / DB Config |
| **Authenticated User Sessions** | In-Memory JavaScript `Map` | ❌ **Non-Persistent** (Cleared on restart) | Redis / Memcached / Signed JWTs |
| **Wholesale Commodity Orders** | In-Memory Array (`submittedOrders`) | ❌ **Non-Persistent** (Resets to baseline) | Relational Orders & Line-Items Tables |
| **Newly Registered Retail Stores** | In-Memory Array (`shops`) | ❌ **Non-Persistent** (Resets to baseline) | Relational Customers / Stores Table |
| **Store Front Photographs** | Local Disk (`server/uploads/`) | ✅ **Persistent** (Local filesystem) | Cloud Object Storage (S3 / Cloud Storage) |

### Key Takeaway on Persistence
When the Node.js backend server (`node index.js`) restarts:
1. **Administrative data persists:** All users created by the Admin, password hashes, role permission overrides, target quotas, team assignments, and audit logs remain intact because they are written to `server/admin_config.json`.
2. **Transactional data resets:** Newly placed orders and newly registered retail stores reset to the baseline seed dataset (`data.js`). Active logged-in users must sign in again because memory sessions are cleared.

---

## 2. Incomplete Features & Mocked Integrations

1. **Payment Gateway Integration**
   - **Current State:** Field agents can book wholesale orders and select payment terms (e.g., Credit, Cash, UPI), but the application does not communicate with a real banking API or payment gateway (such as Razorpay, Stripe, or PhonePe). Orders are recorded directly into the internal ledger without electronic fund transfers.
2. **Live Device GPS Geolocation**
   - **Current State:** When onboarding a store, the app requests the browser's HTML5 Geolocation API (`navigator.geolocation`). If permission is denied or running in an environment without hardware GPS, it falls back to predefined cluster reference coordinates.
3. **SMS OTP Dispatch**
   - **Current State:** Authentication operates on phone number and password verification. While phone numbers are used as login IDs, actual SMS OTP dispatch via an SMS gateway (e.g., Twilio, AWS SNS) is not integrated. Passwords or PINs are validated directly against stored hashes.
4. **Push Notifications**
   - **Current State:** Delivery assignments and status updates do not trigger native push notifications (FCM / APNs) to delivery agents. Delivery agents pull their latest assignments by opening or refreshing the delivery screen.

---

## 3. External Web Service Dependencies

The application relies on third-party HTTP services for maps and road routing. Network firewalls or outages can impact these features:

1. **OSRM Public Routing API (`router.project-osrm.org`)**
   - **Dependency:** Used by `client/src/routing.js` to sequence stops by road distance and draw realistic driving paths.
   - **Limitation:** The public OSRM demo server has rate limits, usage throttling, and does not guarantee 100% uptime.
   - **Mitigation:** The application includes an automatic offline Nearest-Neighbor heuristic that re-orders stops using direct coordinate distance if OSRM is unreachable, clearly indicating to the driver that an offline fallback order was used.
   - **Production Requirement:** Deploy a self-hosted OSRM container or integrate a commercial routing API (Google Directions, Mapbox Directions, or HERE API).

2. **OpenStreetMap & CartoDB Tile Providers**
   - **Dependency:** Public raster tile servers (`tile.openstreetmap.org` and `basemaps.cartocdn.com`).
   - **Limitation:** Subject to public fair-use tile usage policies and internet connectivity.
   - **Mitigation:** The client implements an automatic fallback handler: if OpenStreetMap tiles fail or time out, the map automatically switches to CartoDB Voyager tiles.

---

## 4. Production Deployment Checklist

Before deploying LineCart 2.0 to a public or enterprise production environment, complete the following items:

- [ ] **Set `NODE_ENV=production`**
  - This disables the development shortcut login (`admin` / `admin123`) and enforces strict telephone number authentication.
- [ ] **Configure HTTPS / TLS Termination**
  - The Node.js application runs over HTTP on port 3001. A production reverse proxy (Nginx, Caddy, Cloudflare, or AWS ALB) must terminate HTTPS with valid TLS certificates.
- [ ] **Implement Database Storage Engine**
  - Migrate orders, customers, and inventory catalog from in-memory arrays and JSON files to a relational database (such as PostgreSQL) with ACID transactions.
- [ ] **Distribute Session Storage**
  - Replace the in-memory JavaScript `sessions` Map with Redis or signed JWTs to support multi-instance load balancing.
- [ ] **Restrict CORS Configuration**
  - Replace `app.use(cors())` with an explicit origin whitelist restricting API calls to the authorized production domain.
- [ ] **Secure File Uploads**
  - Store uploaded store photos (`/addcustomer`) in cloud object storage (AWS S3, Google Cloud Storage, or Azure Blob) with content-type and file-size validation, rather than local disk.
- [ ] **Change All Default Passwords**
  - Change all default development passwords for Admin, Sales Manager, Field Sales Agent, and Delivery Agent accounts immediately upon first deployment.
