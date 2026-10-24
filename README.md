# LineCart 2.0 — Web, Laptop & Mobile Suite

Re-engineered from `linecart.apk` (`com.dalavai.linecart`), this project implements the full Field Sales Force Automation, Store Onboarding, and Order Booking system as a cross-platform application.

---

## 🚀 How to Run on Laptop

### Option 1: Desktop Shortcut (Instant)
Double-click the **`LineCart 2.0 (Laptop)`** shortcut created on your Desktop.

### Option 2: Command Line
```powershell
cd linecart-suite/server
node index.js
```
Then visit **[http://localhost:3001](http://localhost:3001)** in any browser.

---

## 📱 How to Build as an Android APK (Mobile)

Because the frontend is built with React + Vite, you can bundle it into an Android APK in 3 minutes using **Capacitor**:

```powershell
cd linecart-suite/client

# 1. Install Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. Initialize Capacitor
npx cap init "LineCart" "com.yourcompany.linecart"

# 3. Add Android Platform
npx cap add android

# 4. Sync web build to Android
npm run build
npx cap sync

# 5. Open in Android Studio to build APK
npx cap open android
```

---

## 💻 How to Package as a Windows `.exe` Desktop App

To bundle it into an installable `.exe` file without needing a browser:

```powershell
cd linecart-suite/client
npm install --save-dev electron electron-builder
```
Then package with:
```powershell
npx electron-builder --win
```

---

## 📂 Decompiled Source Files Location
The original decompiled Java / Kotlin source code from `linecart.apk` is preserved at:
`C:\Users\samma\Desktop\rea\decompiled\sources\com\dalavai\linecart\`
