-- LineCart 2.0 Schema Migration (003_price_requests.sql)
-- Customer-specific price requests, approval workflows, and audit trail

CREATE TABLE IF NOT EXISTS price_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  shop_id INTEGER NOT NULL,
  cluster_id INTEGER NOT NULL,
  agent_id INTEGER NOT NULL,
  requested_price REAL NOT NULL,
  catalog_price REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at TEXT NOT NULL,
  decision_by INTEGER,
  decision_by_name TEXT,
  decision_at TEXT,
  decision_comment TEXT,
  apply_to_catalog INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_price_requests_order ON price_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_price_requests_status ON price_requests(status);
CREATE INDEX IF NOT EXISTS idx_price_requests_agent ON price_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_price_requests_cluster ON price_requests(cluster_id);
CREATE INDEX IF NOT EXISTS idx_price_requests_shop ON price_requests(shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
