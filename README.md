# LineCart 2.0 — Web, Laptop & Mobile Operations Suite

LineCart 2.0 is a field sales force automation, store onboarding, wholesale commodity order booking, and delivery fulfillment platform. Re-engineered from the decompiled `linecart.apk` (`com.dalavai.linecart`), this application provides multi-tier role-based access control supporting **Administrators**, **Sales Managers**, **Field Sales Agents**, and **Delivery Agents**.

---

## 📚 Complete Documentation Suite

### 1. User Manual
- 📝 **[Editable Markdown](docs/USER_MANUAL.md)** | 📄 **[Download PDF](docs/pdf/LineCart_User_Manual.pdf)**
Practical, step-by-step operating instructions for all four user roles (Admin, Sales Manager, Field Sales Agent, and Delivery Agent), credential policies, mobile previews, accessible navigation, and operational troubleshooting.

### 2. Architecture & Workflow Guide
- 📝 **[Editable Markdown](docs/ARCHITECTURE_AND_WORKFLOW_GUIDE.md)** | 📄 **[Download PDF](docs/pdf/LineCart_Architecture_and_Workflow_Guide.pdf)**
Comprehensive technical architecture detailing frontend/backend design, request lifecycles, token-based session security, Leaflet map engine with dual-tile resilience, OSRM road routing, and complete 48+ route API directory.

### 3. Libraries & Technical Reference Guide
- 📝 **[Editable Markdown](docs/LIBRARIES_AND_TECHNICAL_GUIDE.md)** | 📄 **[Download PDF](docs/pdf/LineCart_Libraries_and_Technical_Guide.pdf)**
Complete catalog of installed runtime and development dependencies, external web service providers (OpenStreetMap, CartoDB, OSRM), in-memory persistence boundaries, and production readiness checklist.

---

## ⚡ Quick Start & Prerequisites

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended).
- **Package Manager**: `npm` (bundled with Node.js).
- **Operating System**: Windows, macOS, or Linux.
- **Modern Web Browser**: Chrome, Edge, Firefox, or Safari.

---

### Installation & Local Setup

1. **Clone or Navigate to the Repository**:
   ```bash
   cd linecart-suite
   ```

2. **Install Server Dependencies**:
   ```bash
   cd server
   npm install
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
   node index.js
   ```

5. **Access in Browser**:
   Open **[http://localhost:3001](http://localhost:3001)**.

---

## 🔑 Default Credentials & Role Landing Pages

> [!IMPORTANT]
> The dev username `admin` is enabled **only** when `NODE_ENV=development`. In production mode (`NODE_ENV=production`), development shortcuts are rejected by server authentication.

| Role | Login Identifier | Password | Default Landing Page | Primary Responsibilities |
| :--- | :--- | :--- | :--- | :--- |
| **Administrator** | `admin` *(or phone)* | `admin123` | `/#admin-dashboard` | Full system control, user provisioning, role permissions, manager-agent assignments, target quotas, audit trail. |
| **Sales Manager** | `9876500001` | `password123` | `/#manager-reports` | Team performance tracking, target vs. achieved volume gap analysis, team orders inspection, cluster store coverage. |
| **Field Sales Agent** | `9876543210` | `password123` | `/#overview` | Beat routes, wholesale commodity order booking (Eggs, Onions, Potatoes, etc.), store onboarding with GPS & photo capture. |
| **Delivery Agent** | `9876500050` | `1234` | `/#delivery` | Mobile route map, road-distance sequencing, status progression (Picked Up / Delivered), issue reporting, bilingual audio assistance. |

---

## 🏗️ Architecture Summary

- **Frontend**: Single-Page Application (SPA) built with React 18, Vite 6, Leaflet 1.9, Lucide Icons, and responsive design tokens. Includes laptop and mobile-preview view modes with accessible icon-only Back navigation.
- **Backend**: Node.js & Express REST API running on port 3001. Handles Bearer token authentication, RBAC authorization middleware, route scoping, target calculations, and delivery management.
- **Persistence Model**:
  - **Administrative Data**: Stored persistently on disk in `server/admin_config.json` (users, hashed passwords, manager assignments, targets, role permissions, audit logs, settings).
  - **Transactional Data**: Orders and newly registered retail stores reside in server RAM (resetting to baseline on server restart). For production deployments, a persistent database (PostgreSQL/MongoDB) is required.
- **Security**: Cryptographic password hashing using Node.js native `crypto.scryptSync` with 16-byte random salts. Mandatory password rotation on initial login.

---

## 🛠️ Build Options

### Android APK (Mobile) via Capacitor
The React frontend can be packaged into an Android APK using Capacitor:
```powershell
cd client
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "LineCart" "com.dalavai.linecart"
npx cap add android
npm run build
npx cap sync
npx cap open android
```

### Windows Desktop (`.exe`) via Electron
```powershell
cd client
npm install --save-dev electron electron-builder
npx electron-builder --win
```

---

## 📂 Repository Structure

```
linecart-suite/
├── client/                     # React 18 + Vite Frontend Application
│   ├── dist/                   # Production compiled assets served by Express
│   ├── src/                    # UI Components, Screens, State Management, and CSS
│   ├── package.json            # Frontend dependency manifest
│   └── vite.config.js          # Vite build configuration
├── server/                     # Node.js + Express Backend API
│   ├── index.js                # Core API server, auth middleware, and route handlers
│   ├── admin_config.json       # Persistent administrative configuration and audit logs
│   ├── data.js                 # Baseline mock shops, catalog, and cluster data
│   └── package.json            # Server dependency manifest
├── docs/                       # Project Documentation
│   ├── USER_GUIDE.md           # Role-based User Manual & Operational Troubleshooting
│   ├── ARCHITECTURE.md         # Comprehensive Technical Architecture & API Directory
│   ├── LIBRARIES_AND_TOOLS.md  # Installed libraries & external web services reference
│   └── KNOWN_LIMITATIONS.md    # In-memory boundaries & production deployment checklist
└── README.md                   # Project overview & getting started guide
```
