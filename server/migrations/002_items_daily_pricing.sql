-- LineCart 2.0 Schema Migration (002_items_daily_pricing.sql)
-- Adds active flag and audit timestamps to items, cluster-specific daily pricing, and immutable price change history.

-- 1. Cluster-Specific Daily Prices
CREATE TABLE IF NOT EXISTS cluster_item_prices (
  id TEXT PRIMARY KEY,
  cluster_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  price REAL NOT NULL,
  effective_date TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_by_name TEXT NOT NULL,
  UNIQUE(cluster_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_item_prices_cluster ON cluster_item_prices(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_item_prices_item ON cluster_item_prices(item_id);

-- 2. Auditable Price History Log
CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL,
  cluster_id INTEGER NOT NULL DEFAULT 0,
  old_price REAL NOT NULL,
  new_price REAL NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  changed_by INTEGER NOT NULL,
  changed_by_name TEXT NOT NULL,
  idempotency_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_price_history_item_time ON price_history(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_cluster ON price_history(cluster_id);
