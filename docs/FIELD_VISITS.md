# Field Visit Management and GPS Verification

Field Sales Agents prove they were at an assigned shop. The phone takes a fresh GPS reading and the server decides whether it counts. Introduced with migration 007.

## How a visit is verified

1. The agent opens **My Visits**, picks an assigned shop and taps **MARK AS VISITED**.
2. The app asks for foreground location permission (precise location required) and takes a **fresh** fix: high accuracy, nothing older than the request, a 20-second limit, and no fallback to a cached or approximate position.
   - **Android:** the app-local `LocationIntegrity` plugin (`client/android/.../LocationIntegrityPlugin.java`) uses Google Play services' **fused location provider**. This is the same engine as "Fetch Location" in customer creation; it combines GPS, Wi-Fi and mobile network, so it works indoors.
     - It keeps reading fixes until one meets the server's accuracy limit (default ±30 m). Otherwise, at the time limit, it returns the best fix it saw, and the server applies the rule (`poor_accuracy`).
     - It reports Android's mock-location flag; any mock fix during the request marks the visit as mock.
     - Without Play services it uses the platform GPS and network providers with the same rules.
     - If the plugin is missing (older builds), the app falls back to Capacitor Geolocation and the mock state is recorded as `unknown`.
   - **Error messages:** each case has its own message: precise location off (approximate only), permission denied, Location turned off, and no fix in time.
   - **On screen:** the screen shows the reading (latitude, longitude, accuracy) as soon as it arrives, with a seconds counter while waiting.
   - **Why this changed (22 Nov 2026):** visits used to ask Android for a satellite-only GPS fix, which often times out indoors, while customer creation used the fused provider. Approximate-only permission was also misreported as "permission off".
   - **Web:** `navigator.geolocation`, with mock state `unknown`.
3. The app sends `POST /api/visits/verify` with `shopId`, `latitude`, `longitude`, `accuracy`, the fix time, the mock flag, the platform and an idempotency key. Any client-side distance or status is ignored.
4. The server (`server/visits.js`, `server/geo.js`):
   - checks the session, that the caller is a Field Sales Agent, and that the shop is assigned to them (otherwise 403);
   - validates the coordinates (finite, in range, not 0,0) and the accuracy (otherwise 400);
   - reads the shop's registered coordinates from the database;
   - decides the outcome **in this order**:
     | Check | Result | HTTP |
     |---|---|---|
     | Shop has no valid location (0,0 or outside India) | `location_not_registered` | 422 |
     | Accuracy worse than the limit (default **30 m**), however close | `poor_accuracy` | 422 |
     | Haversine distance over the radius (default **100 m**) | `too_far` (distance returned) | 422 |
     | Inside, but a risk flag applies | `flagged` (recorded, sent for review) | 200 |
     | Inside, no risk flag | `verified` | 200 |
   - **Risk flags:**
     - `mock_location_detected`: Android reports a mock provider.
     - `stale_gps_fix`: the fix is older than 60 seconds when sent. The age is computed from the device's own clock values, so clock skew cancels out.
     - `implausible_travel_speed`: more than 150 km/h since the agent's previous accepted visit, over more than 1 km.
   - records the attempt with **server** time, the IST visit date, the device reading, the server distance, the shop position and the settings used, under an allocation lock.

**Duplicates.**
- A repeat of the same request (same idempotency key) returns the original result.
- An accepted visit to the same shop by the same agent within the **duplicate window** (default 30 minutes) is returned rather than recorded again.
- Later visits the same day, and visits on other days, are recorded as separate visits. History is never overwritten.

## What counts

- Only `verified` visits count in summaries. `flagged` visits count only after a manager or admin **approves** them, which sets the status to `verified` and records the decision, reviewer, time and comment. Rejected visits get status `rejected`.
- Failed attempts (`too_far`, `poor_accuracy`, `location_not_registered`) and flagged visits are kept for investigation.
- The audit log records `VISIT_VERIFIED`, `VISIT_FLAGGED`, `VISIT_REVIEW` and `SHOP_LOCATION_UPDATE` events.

## Who can do what

| Action | Field Sales Agent | Sales Manager | Admin |
|---|---|---|---|
| Verify a visit | Own assigned shops | No | No |
| See visits | Own | Own team (`manager_assignments`) | All |
| Review flagged visits | No | Own team | All |
| Set or correct shop coordinates | No | Shops of own team's agents | All |
| Change verification settings | No | No | Yes |

Permission keys: `visits` page and `record_visits` (agent); `field-visits` page plus `view_team_visits`, `review_visits` and `manage_shop_locations` (manager). Migration 007 added these to stored role permissions once, without removing anything.

## Shop coordinates

- Missing coordinates are stored as `0,0`, which pre-dates this feature. Such shops show **"Shop location not registered"** and can't be verified.
- Coordinates change only through `PUT /api/shops/:id/location`:
  - valid India coordinates only (latitude 6 to 37.5, longitude 68 to 97.5);
  - a reason is required;
  - each change writes `shop_location_history` (old and new values, who, role, when, source `manual` or `device_gps`, reason) and an audit entry.
- Visits never change shop coordinates.

## Settings (`app_settings` "global", Admin → Field Visits → Verification settings)

| Key | Default | Allowed |
|---|---|---|
| `visitGeofenceRadiusM` | 100 | 20–1000 |
| `visitMaxGpsAccuracyM` | 30 | 5–200 |
| `visitDuplicateWindowMinutes` | 30 | 0–240 (0 turns off the window; idempotency keys still apply) |
| `visitMaxFixAgeSeconds` | 60 | 10–600 |
| `visitMaxTravelSpeedKmh` | 150 | 30–1000 |

Each visit stores the radius and accuracy limit used, so later changes don't rewrite history.

## API

- `GET /api/visits/my-shops?filter=all|pending|visited_today|not_visited_today` (agent)
- `POST /api/visits/verify` (agent)
- `GET /api/visits?from=&to=&agentId=&shopId=&status=all|verified|flagged|rejected|failed|too_far|poor_accuracy|location_not_registered`
- `GET /api/visits/summary?date=` (manager, admin)
- `POST /api/visits/:id/review` `{ decision: approve|reject, comment }`
- `GET /api/visits/settings`
- `GET /api/visits/shop-locations?filter=missing|all`, `PUT /api/shops/:id/location`, `GET /api/shops/:id/location-history`

## Database (migration 007)

- `shop_visits`: id (UUID), shop_id, agent_id, status, visit_date (IST), visited_at (server time), latitude, longitude, gps_accuracy_m, distance_m, shop_latitude, shop_longitude, geofence_radius_m, max_accuracy_m, mock_location, risk_flags (JSON), fix_age_ms, client_time, platform, idempotency_key (unique), review_decision, reviewed_by, reviewed_by_name, reviewed_at, review_comment, created_at.
- `shop_location_history`: id, shop_id, old and new coordinates, source, reason, changed_by, changed_by_name, changed_by_role, changed_at.
- Both tables are additive. The migration was validated as an upgrade of a populated PostgreSQL 17 database: existing rows unchanged, admin role customisations kept, and it is idempotent.

## Limits of GPS proof

- GPS is evidence, not proof.
- A rooted device can fake locations without setting the mock flag.
- Indoor readings are often worse than ±30 m, so agents may need to step outside.
- The server-side checks, the review workflow and the failed-attempt history are there to make cheating visible, not impossible.

## Testing status

- **Automated, on SQLite and PostgreSQL 17:**
  - `tests/geo.test.js`: distance maths and decisions.
  - `tests/shop-visits.test.js`: the 12 required scenarios, plus review, coordinates, settings and the migration.
  - `tests/visit-client.test.js`: permission denied, network failure and the fresh-fix options.
- **Browser (simulated positions):** agent verified, too far and poor accuracy; manager summary, log, map and the coordinate editor.
- **Needs a physical Android device:**
  - the plugin's fresh fix and mock-location detection;
  - the runtime permission prompts, GPS-off and timeout behaviour;
  - real-world accuracy outdoors and indoors;
  - Android 7–11 (older API path) and 12 or later (`isMock()`).
