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
- Android APKs: `node scripts/build-android.mjs --env staging|local|production [--aab]` (output in `dist-android/`, guide in `docs/ANDROID_BUILD.md`). Production needs `LINECART_PRODUCTION_API_URL` and the owner's keystore; never commit signing files.
- Android compile check: in `client/android`, `gradlew.bat :app:compileDebugJavaWithJavac` (JAVA_HOME = JDK 21, ANDROID_HOME = SDK). Run `npx cap sync android` in `client/` first after client changes.
- `npm run build`: installs server and client, then runs `vite build` (output in `client/dist`).
- `npm start`: `node server/index.js`.

## Hard rules
- Never connect to Supabase or any remote DB from this machine. Tests refuse any `DATABASE_URL` except an explicitly opted-in localhost PostgreSQL (guard in `db.js` init and in `run-tests.mjs`); keep it that way.
- Pushing to `main` auto-deploys `linecart-staging.onrender.com` (migrations run on staging at boot). The user approved pushing after each verified change; production deploys still need explicit approval.
- Never deploy to production, change Render settings, or run `migrate.js --restore` against a remote DB without the user's explicit approval.
- Work on `main`, in small commits. Never force-push or rewrite history. Push only after `npm test` and `npm run build --prefix client` pass.
- Keep API contracts: legacy aliases (`/login`, `/createorder`, `/admin_panel/public/api/linecart/*`, ...) and the `status` field mirrored in JSON bodies. Add response fields; never rename or remove them.
- No schema change without a reviewed, numbered migration that works on both Postgres and SQLite.
- The server is the authority for identity, scope, prices and dates. The client only sends intent.

## Business decisions (final)
- **Order creation is online only.** No offline order queue, no TEMP order ids. The sync queue still carries delivery-status and price updates.
- Admin setup in production requires a `SETUP_TOKEN`.
- Production API URL: not decided yet; only `linecart-staging.onrender.com` exists. The production APK must not use staging.

## Environment on this machine
Git 2.56, Node 22.23 LTS, gh 2.105, Temurin JDK 21, Android SDK at `%LOCALAPPDATA%\Android\Sdk` (platform 36, build-tools 36.0.0). New shells may need PATH refreshed from the Machine and User values.
