# LineCart Android: build, sign and install

The Android app is a Capacitor 8 wrapper around the React client (`client/`). The only value built into the app is the public server address. No database URL, Supabase key, service-role key or other secret is ever put in the APK; every build is scanned for them.

## The three builds

Both the debug and the release app use the **production** server: the existing Render service `https://linecart-staging.onrender.com` and, through it, the production Supabase database. The hostname contains "staging", but this is the live service with real business data. Server addresses live in one file, [`config/android-environments.json`](../config/android-environments.json).

| Command (from the repo root) | Output in `dist-android/` | App id / launcher name | Server | Debuggable | Signing |
|---|---|---|---|---|---|
| `node scripts/build-android.mjs debug` | `linecart-<ver>-debug.apk` | `in.linecart.suite.debug` / "LineCart DEBUG" | production | yes (WebView inspection, logs) | Android debug key: development only, never distribute |
| `node scripts/build-android.mjs release` | `linecart-<ver>-release.apk` (or `-release-unsigned.apk` without a keystore) | `in.linecart.suite` / "LineCart Wholesale" | production | no | owner's release keystore only |
| `node scripts/build-android.mjs release --aab` | `linecart-<ver>-release.aab` (Play Store) | `in.linecart.suite` | production | no | owner's release keystore only |
| `node scripts/build-android.mjs local` | `linecart-local-<ver>-debug.apk` | `in.linecart.suite.local` / "LineCart LOCAL" | `http://10.0.2.2:3001` (local server on the emulator host, development data) | yes | Android debug key |

How the builds differ, and what stays the same:
- **Same server, accounts and data.** Debug and release talk to the same production server, use the same accounts and see the same data. The only differences: the debug app is named **LineCart DEBUG** on the launcher and in Android settings, and it can be inspected with Chrome DevTools. By the owner's decision it shows no on-screen badge or sign-in banner, so screens look exactly like the release app.
- **Separate app ids.** The three apps install side by side. Each keeps its own sign-in, offline cache, fingerprint credential and permissions on the phone. A session made in one app is never visible to another. Signing in to both creates two separate server sessions for the same user, and signing out of one does not sign out the other. An admin editing or deactivating the user ends both.
  - One app id for debug and release was rejected: a debug-signed app and a release-signed app with the same id cannot update over each other, and switching would mean uninstalling and losing unsent delivery and price updates.
- **Local build.** It is for isolated development testing against `scripts/dev-local.mjs`. It shows a blue **LOCAL TEST SERVER** badge and never reaches production.
- **No fallbacks.** No build silently falls back to staging, localhost or demo data. A native build without a server address shows a red error and cannot sign in. Demo accounts are refused by the production server.

### Security of a debug APK
The debug app is debuggable. Anyone with the phone and a USB cable can read its signed-in token and cached business data with the Android debugging tools. Server-side protections are unchanged. **Install the debug APK only on your own development devices; never give it to field staff.** Release builds are not debuggable and have WebView inspection off; Capacitor follows the build's debuggable flag, and nothing overrides it.

### Stale-build protection
- `scripts/build-android.mjs` builds the web bundle with the target server and writes a marker (`linecart-build.json`: target, server, build type, git commit) into it.
- Before packaging, a Gradle check (`verifyLinecartWebBundle<Variant>`) refuses to build if:
  - the marker is missing or was made for another build (for example a `local` bundle in a release);
  - the bundle does not contain the target server, or contains any other environment's server, an emulator or localhost address, another `*.onrender.com` host, a database URL, a Supabase host or service key, or a private key.
- Running `gradlew assembleRelease` by hand on a leftover bundle therefore fails with the command to use instead.
- After Gradle, the script inspects the final file and deletes it if any check fails. It checks the package id, debuggable flag, backend addresses, backup and cleartext settings, and secrets anywhere in the APK, including native code and resources.
- Any APK can be checked the same way:
  ```
  node scripts/inspect-apk.mjs dist-android\linecart-1.1.0-release.apk --expect-url https://linecart-staging.onrender.com --expect-id in.linecart.suite --expect-debuggable false
  ```

The other security settings:
- Release builds allow HTTPS only (`network_security_config.xml`). Debug-type builds may use plain HTTP only to `10.0.2.2`, `localhost` and `127.0.0.1`, which the local build needs. The production debug build never calls them.
- `allowBackup="false"`: Android backup does not copy the session token or cached data off the phone.

Version: `client/package.json` `version` (now `1.1.0`). The script turns it into `versionCode = major*10000 + minor*100 + patch` (1.1.0 gives 10100). Raise the version before every release; Android refuses an upgrade with a lower or equal versionCode.

Each build writes `<file>.sha256` and updates `dist-android/build-info.json`: app id, label, server, debuggable, signing, permissions, addresses found, size and hash. `dist-android/` is git-ignored.

## Requirements

- Node 22, JDK 21 (`JAVA_HOME`), Android SDK with platform 36 and build-tools 36 (`ANDROID_HOME`).
- `npm install --prefix client` once.
- On this machine the repo is inside OneDrive, which interferes with Gradle:
  - The script puts Gradle output in `%LOCALAPPDATA%\linecart-gradle-build` automatically. To do the same by hand, set `LINECART_GRADLE_BUILD_ROOT`.
  - It retries Gradle once if OneDrive briefly locks freshly copied web assets.

## Release signing (owner only)

Release signing is never committed, and release builds are never signed with the debug key. Without your keystore, the release build is produced **unsigned** (`...-release-unsigned.apk`), which cannot be installed.

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
3. Run `node scripts/build-android.mjs release` (add `--aab` for Play). The script reports the signer. Check it yourself with:
   ```
   %ANDROID_HOME%\build-tools\36.0.0\apksigner.bat verify --print-certs dist-android\linecart-1.1.0-release.apk
   ```
   If the app goes on Google Play with Play App Signing, this key is your upload key.

## Install

On a phone:
1. Settings → Security (or Apps → Special access) → allow **Install unknown apps** for the browser or file manager you use.
2. Copy the APK to the phone and open it, or connect with USB debugging on and run:
   ```
   adb install -r dist-android\linecart-1.1.0-release.apk
   ```
3. Open the app and allow Location when you first mark a visit. Allow Camera when you first take a visit photo.

The debug and local APKs install the same way and appear as separate apps: "LineCart DEBUG" and "LineCart LOCAL". For the local build, start the local server on port 3001 first (`node scripts/dev-local.mjs`) and use the emulator.

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

Debug-type builds allow WebView remote debugging (`chrome://inspect`). Release builds do not. Emulator tests use AVD `linecart_test` (Pixel 7, API 35). `adb emu geo fix <lng> <lat>` sets the GPS fix. A test provider simulates a mock location: `adb shell cmd location providers add-test-provider gps`. Write tests belong on the **local** build; the debug build works on real production data.
