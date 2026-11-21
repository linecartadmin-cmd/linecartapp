-- LineCart Migration 007: GPS-verified shop visits and shop coordinate history
-- Additive only: two new tables and their indexes. No existing table or row is changed by this file.
-- (The one-time role-permission update for the new pages is applied in server/db.js and recorded as
--  '007_shop_visits_permissions' in schema_migrations.)

-- Every visit verification attempt, successful or not. Only status 'verified' counts as a visit;
-- 'flagged' visits count only after a reviewer approves them (status becomes 'verified').
CREATE TABLE IF NOT EXISTS shop_visits (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(shop_id),
  agent_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,                 -- verified | flagged | rejected | too_far | poor_accuracy | location_not_registered
  visit_date TEXT NOT NULL,             -- server date in Asia/Kolkata (YYYY-MM-DD)
  visited_at TEXT NOT NULL,             -- authoritative server timestamp (ISO 8601 UTC)
  latitude REAL,
  longitude REAL,
  gps_accuracy_m REAL,
  distance_m REAL,                      -- calculated on the server (Haversine)
  shop_latitude REAL,                   -- shop position used for the check
  shop_longitude REAL,
  geofence_radius_m REAL,               -- settings in force for the check
  max_accuracy_m REAL,
  mock_location TEXT NOT NULL DEFAULT 'unknown',   -- yes | no | unknown
  risk_flags TEXT NOT NULL DEFAULT '[]',          -- JSON array of flag codes
  fix_age_ms INTEGER,                   -- age of the GPS fix when sent (device clock difference)
  client_time TEXT,                     -- diagnostic only
  platform TEXT,                        -- android | web | other
  idempotency_key TEXT UNIQUE,
  review_decision TEXT,                 -- approved | rejected (flagged visits only)
  reviewed_by INTEGER,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_comment TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_visits_agent_date ON shop_visits(agent_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_shop_visits_shop_date ON shop_visits(shop_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_shop_visits_status ON shop_visits(status);

-- Every change to a shop's registered coordinates (never changed automatically)
CREATE TABLE IF NOT EXISTS shop_location_history (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(shop_id),
  old_latitude REAL,
  old_longitude REAL,
  new_latitude REAL NOT NULL,
  new_longitude REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',  -- manual | device_gps
  reason TEXT NOT NULL DEFAULT '',
  changed_by INTEGER NOT NULL,
  changed_by_name TEXT NOT NULL,
  changed_by_role TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_location_history_shop ON shop_location_history(shop_id, changed_at);
