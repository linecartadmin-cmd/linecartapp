# LineCart: notes for Claude

Wholesale produce ordering and delivery app. Four roles: Admin, Sales Manager, Field Sales Agent, Delivery Agent.
Status, checklist and known issues: `docs/IMPLEMENTATION_STATUS.md`. Full technical handover: https://claude.ai/artifact/JtwGKXfVbryRbdzH4KsYWU

## Layout
- `server/index.js`: Express 4 API, all routes. `server/db.js`: DB adapter (Postgres via `DATABASE_URL`, else `node:sqlite` file), boot-time migrations and seed, `loadDatabaseState()`.
- `server/migrate.js`: backup, restore, verify, admin password reset CLI. `server/backup.js`: full-fidelity backup/restore.
- `server/visits.js` + `server/geo.js`: GPS-verified shop visits (migration 007). Feature guide: `docs/FIELD_VISITS.md`.
- `server/http-errors.js`: async route wrapper, request ids, JSON error logs.
- `client/src/api.js`: every fetch. `client/src/offline/`: IndexedDB cache, sync queue, biometric session.
- `client/android/`: Capacitor 8 Android project (`in.linecart.suite`). App-local plugin `LocationIntegrityPlugin.java` (fresh GPS fix + mock flag) is registered in `MainActivity`.
- `tests/*.test.js`: `node:test` suites; `tests/run-tests.mjs` is the runner; `tests/fixtures/` holds test-only seed data.

## Commands
- `npm test`: starts a server on :3001 against a temporary SQLite file, seeds fixtures, runs all suites. `npm test -- <file>.test.js` runs one suite.
- `LINECART_TEST_PG_URL=postgresql://user:pass@127.0.0.1:<port>/<db> npm test`: same suite on a disposable PostgreSQL on this machine (schema is dropped first; localhost only). A throwaway PostgreSQL 17 (UTF-8) can be started with the `embedded-postgres` npm package outside the repo.
- Android APKs: `node scripts/build-android.mjs debug | release [--aab] | local` (output in `dist-android/`, guide in `docs/ANDROID_BUILD.md`). Debug (`in.linecart.suite.debug`) and release (`in.linecart.suite`) both use the production server from `config/android-environments.json`; `local` (`in.linecart.suite.local`) uses `http://10.0.2.2:3001`. A Gradle check refuses stale or mismatched web bundles; `scripts/inspect-apk.mjs` checks any APK. Release is signed only with the owner's keystore, never the debug key; never commit signing files.
- Android compile check: in `client/android`, `gradlew.bat :app:compileDebugJavaWithJavac` (JAVA_HOME = JDK 21, ANDROID_HOME = SDK). Run `npx cap sync android` in `client/` first after client changes.
- `npm run build`: installs server and client, then runs `vite build` (output in `client/dist`).
- `npm start`: `node server/index.js`.

## Hard rules
- Never connect to Supabase or any remote DB from this machine. Tests refuse any `DATABASE_URL` except an explicitly opted-in localhost PostgreSQL (guard in `db.js` init and in `run-tests.mjs`); keep it that way.
- **`linecart-staging.onrender.com` and its Supabase database ARE PRODUCTION** (decided 22 Nov 2026): real business data, despite the name. Pushing to `main` auto-deploys it and runs migrations at boot, so **ask the user before every push**.
- Production testing is read-only by default. Write tests only with test records the user approved in advance, clearly labelled. Never create, modify or delete existing business records, and never run migrations, seed, reset, restore or cleanup there, without explicit approval. Never change Render or Supabase settings or environment variables.
- Never type the user's real passwords yourself; credentialed checks run as scripts the user starts in their own terminal. Never print or store tokens, passwords or database URLs.
- Every production change needs a backup (`npm run db:backup` from the Render shell, run by the user) and a written rollback plan first.
- Work on `main`, in small commits. Never force-push or rewrite history. Push only after `npm test` and `npm run build --prefix client` pass, and only with the user's go-ahead.
- Keep API contracts: legacy aliases (`/login`, `/createorder`, `/admin_panel/public/api/linecart/*`, ...) and the `status` field mirrored in JSON bodies. Add response fields; never rename or remove them.
- No schema change without a reviewed, numbered migration that works on both Postgres and SQLite.
- The server is the authority for identity, scope, prices and dates. The client only sends intent.

## Business decisions (final)
- **Order creation is online only.** No offline order queue, no TEMP order ids. The sync queue still carries delivery-status and price updates.
- Admin setup in production requires a `SETUP_TOKEN`.
- Production = the existing Render service (`https://linecart-staging.onrender.com`) and its Supabase database. No separate staging environment exists. Both the debug and the release APK use it; the debug APK has no on-screen badge (owner decision, 22 Nov 2026); it is identified by its launcher name "LineCart DEBUG" and app id, and must never be given to field staff.

## Environment on this machine
Git 2.56, Node 22.23 LTS, gh 2.105, Temurin JDK 21, Android SDK at `%LOCALAPPDATA%\Android\Sdk` (platform 36, build-tools 36.0.0). New shells may need PATH refreshed from the Machine and User values.
