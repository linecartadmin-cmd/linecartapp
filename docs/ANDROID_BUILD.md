# LineCart Android: build, sign and install

The Android app is a Capacitor 8 wrapper around the React client (`client/`). The only value built into the app is the public API base URL. No database URL, Supabase key, service-role key or other secret is ever put in the APK.

## Builds and environments

| Command (from the repo root) | Output | App id / name | API |
|---|---|---|---|
| `node scripts/build-android.mjs --env staging` | `dist-android/linecart-staging-<ver>-debug.apk` | `in.linecart.suite.staging` / "LineCart STAGING" | `https://linecart-staging.onrender.com` |
| `node scripts/build-android.mjs --env local` | `dist-android/linecart-local-<ver>-debug.apk` | same as staging | `http://10.0.2.2:3001` (emulator only: the host machine's port 3001) |
| `LINECART_PRODUCTION_API_URL=https://... node scripts/build-android.mjs --env production` | `dist-android/linecart-production-<ver>-release.apk` | `in.linecart.suite` / "LineCart Wholesale" | the URL you pass |
| same, plus `--aab` | `dist-android/linecart-production-<ver>-release.aab` (Play Store) | `in.linecart.suite` | the URL you pass |

How staging and production are kept apart:
- Test builds use a different app id (`.staging` suffix), so they install next to the production app and never replace it. They show an amber **STAGING BUILD · test data only** banner with the server host on the sign-in screen.
- The production build refuses to run without `LINECART_PRODUCTION_API_URL`, requires `https://`, refuses any URL containing "staging", and checks that the built bundle does not contain the staging URL.
- A native build made without any API URL shows a red "built without a server address" alert. There is no hidden fallback to staging.
- Release builds allow HTTPS only (`network_security_config.xml`). Only debug builds may use plain HTTP, and only to `10.0.2.2`, `localhost` and `127.0.0.1`.
- `allowBackup="false"`: Android cloud/ADB backup does not copy the session token or cached data off the phone.

Version: `client/package.json` `version` (now `1.1.0`). The script turns it into `versionCode = major*10000 + minor*100 + patch` (1.1.0 gives 10100). Raise the version before every release; Android refuses an upgrade with a lower or equal versionCode.

Each build writes `<file>.sha256` and updates `dist-android/build-info.json` (environment, API URL, app id, version, signing state, size, hash). `dist-android/` is git-ignored.

## Requirements

- Node 22, JDK 21 (`JAVA_HOME`), Android SDK with platform 36 and build-tools 36 (`ANDROID_HOME`).
- `npm install --prefix client` once.
- On this machine the repo is inside OneDrive, which breaks Gradle build folders. The script then puts Gradle output in `%LOCALAPPDATA%\linecart-gradle-build` automatically. To do the same by hand, set `LINECART_GRADLE_BUILD_ROOT`.

## Release signing (owner only)

Release signing is never committed. Without it, the production build is produced **unsigned** (`...-release-unsigned.apk`), which cannot be installed.

1. Create the keystore once, **outside the repository**, and keep it and its passwords somewhere safe (a password manager plus an offline copy). Losing it means you can never update the installed app:
   ```
   keytool -genkeypair -v -keystore C:\secure\linecart-release.jks -alias linecart -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Create `client/android/keystore.properties` (git-ignored, as are `*.jks` and `*.keystore`):
   ```
   storeFile=C:/secure/linecart-release.jks
   storePassword=<your store password>
   keyAlias=linecart
   keyPassword=<your key password>
   ```
   Or set the environment variables `LINECART_KEYSTORE_FILE`, `LINECART_KEYSTORE_PASSWORD`, `LINECART_KEY_ALIAS` and `LINECART_KEY_PASSWORD`.
3. Build with `--env production` (and `--aab` for Play). Check the signature:
   ```
   %ANDROID_HOME%\build-tools\36.0.0\apksigner.bat verify --print-certs dist-android\linecart-production-1.1.0-release.apk
   ```
   If the app goes on Google Play with Play App Signing, this key is your upload key.

## Install

On a phone:
1. Settings → Security (or Apps → Special access) → allow **Install unknown apps** for the browser or file manager you use.
2. Copy the APK to the phone and open it, or connect with USB debugging on and run:
   ```
   adb install -r dist-android\linecart-staging-1.1.0-debug.apk
   ```
3. Open the app and allow Location when you first mark a visit. Allow Camera when you first take a visit photo.

On the emulator: `adb install -r <apk>`. For the `local` build, start the local server on port 3001 first (`node scripts/dev-local.mjs`).

Check a downloaded file before installing: `certutil -hashfile <apk> SHA256` must match the `.sha256` file.

## Permissions the app asks for

| Permission | Used for |
|---|---|
| Internet, network state | API calls, the online check before placing orders |
| Fine and coarse location | Fresh GPS fix for visit verification; delivery route |
| Camera | Visit photos (`getUserMedia` in the WebView); the camera is optional hardware |
| Biometric / fingerprint | Optional quick unlock of a saved session |

No push notifications: the app has no notification feature and no Firebase configuration. Adding push would need a Firebase project (`google-services.json`) and server work.

## Testing a debug build

Debug builds allow WebView remote debugging (`chrome://inspect`). Release builds do not. The emulator tests on 22 Nov 2026 used AVD `linecart_test` (Pixel 7, API 35). `adb emu geo fix <lng> <lat>` sets the GPS fix. A test provider simulates a mock location: `adb shell cmd location providers add-test-provider gps`.
