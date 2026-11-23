# Deploying the UI redesign to production

Production is the Render service `https://linecart-staging.onrender.com` and its Supabase database. A push to `main` deploys it automatically and runs boot-time migrations.

## What is deployed
Fast-forward of `main` (`2f958df`) to the tip of `ui-redesign-foundation`: Phase 0 Stage A security and scope work, the order-status integrity fix, the UI foundation, the Delivery Agent, Field Sales Agent, Sales Manager and Admin redesigns, and the final polish (Today's Visits count, phone table cards, icons). See `docs/IMPLEMENTATION_STATUS.md` and `docs/ui-redesign/`.

## Preflight (checked 23 Nov 2026)
- **No migration and no schema change**: nothing under `server/migrations/` and no change to `server/db.js` in the diff. Boot runs only the migrations already applied in production.
- **No new environment variables.** One new client dependency (`@capacitor/app`, Android back button), already in `client/package-lock.json`.
- **API contracts**: additive only (new `code` on 401/403 bodies, `currentStatus`/`code` on 409 bodies, `counts.verifiedVisitsToday` and `counts.flaggedVisitsToday` on `/api/visits/my-shops`). Legacy aliases unchanged.
- **Behaviour changes users may notice**: closed orders (Delivered, Could not deliver, Cancelled) can no longer be changed; cancellation only before pick-up; stale offline delivery updates are refused with 409 and shown as "not accepted by server"; admin edits accept only the seven recognised statuses.
- **Unrecognised statuses**: an order whose stored status is not one of the seven recognised values cannot be moved by any role after deployment (409, nothing written). `main` already restricted the statuses its screens and delivery endpoint write, so such rows are unlikely. To check, the owner can run the read-only `node scripts/prod-status-check.mjs https://linecart-staging.onrender.com` (signs in as an Admin, reads orders, prints status counts; writes nothing).
- Installed apps keep working: they send the same token in both credential headers, which the stricter auth accepts.

## Backup (owner, before the push)
`npm run db:backup` writes the file to `server/backups/` on the Render instance. **Render replaces the instance filesystem on every deploy, so that file is lost by the very deploy it protects** unless it is copied off first. Use at least one backup that lives outside the instance:
1. **Supabase**: dashboard → the project → Database → Backups: confirm a successful backup from today exists (read-only look; available backups depend on the Supabase plan), and/or
2. **Render shell backup copied off**: Render dashboard → Shell: `npm run db:backup`, note the printed file name, row counts and checksum, then copy the file off the instance before the push.

The push does not proceed until the owner confirms which backup exists and where it is.

## Rollback plan
Because this release has no migration, rolling back the code is enough; no database change has to be undone.
1. **Fastest**: Render dashboard → the service → **Events/Deploys** → the previous successful deploy (commit `2f958df`) → **Rollback**. No settings change.
2. **Through git** (if the dashboard rollback is unavailable): `git revert --no-edit 2f958df..<deployed tip>` on `main` and push; this adds revert commits (no force-push, no history rewrite) and triggers a normal deploy of the old code.
3. **Data**: only if business data was damaged (not expected: no schema or data migration in this release), restore from the off-instance backup above (Supabase restore, or `server/migrate.js --restore` with the copied file), run by the owner after reviewing it.

## Post-deployment checks (read-only)
- `GET /api/health` returns 200 with the expected migration list; `GET /api/ping` returns 200.
- The page loads; its asset file names match a local `npm run build --prefix client` of the deployed commit.
- Sign-in and read-only screens with the owner's accounts, run by the owner. No orders created, edited, cancelled or deleted.
- Render logs show no startup errors.
