-- LineCart 2.0 PostgreSQL Schema Migration (001_initial_schema.sql)
-- Supports concurrent transactions, unique mobile numbers, foreign key integrity, and durable sessions.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clusters (
  cluster_id INTEGER PRIMARY KEY,
  cluster_name TEXT NOT NULL,
  survey_items_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS survey_items (
  item_id INTEGER PRIMARY KEY,
  item_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  item_id INTEGER PRIMARY KEY,
  item_name TEXT NOT NULL,
  item_image TEXT DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  cprice REAL NOT NULL DEFAULT 0,
  kgs_per_unit INTEGER NOT NULL DEFAULT 50,
  remarks INTEGER NOT NULL DEFAULT 0,
  unit_type TEXT NOT NULL DEFAULT 'Kgs'
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT UNIQUE,
  phone_valid INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  cluster_id INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_on TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, active);

CREATE TABLE IF NOT EXISTS shops (
  shop_id INTEGER PRIMARY KEY,
  cluster_id INTEGER NOT NULL,
  shop_name TEXT NOT NULL,
  shop_category TEXT NOT NULL DEFAULT 'Retail',
  owner_name TEXT NOT NULL DEFAULT '',
  contact1 TEXT NOT NULL DEFAULT '',
  contact2 TEXT NOT NULL DEFAULT '',
  latitude REAL NOT NULL DEFAULT 0,
  longitude REAL NOT NULL DEFAULT 0,
  address TEXT NOT NULL DEFAULT '',
  pincode TEXT NOT NULL DEFAULT '',
  payment_mode INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL DEFAULT 6,
  photo TEXT NOT NULL DEFAULT 'no_image.jpg',
  photo_mime TEXT,
  photo_size INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_on TEXT NOT NULL,
  survey_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_shops_cluster_id ON shops(cluster_id);
CREATE INDEX IF NOT EXISTS idx_shops_created_by ON shops(created_by);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  serial_no INTEGER UNIQUE NOT NULL,
  shop_short_id TEXT NOT NULL,
  customer_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  shop_category TEXT NOT NULL DEFAULT 'Retail',
  sperson_id INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  cluster_id INTEGER NOT NULL,
  order_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'In progress',
  items_count INTEGER NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  delivery_agent_id INTEGER,
  delivery_reason TEXT,
  delivery_note TEXT,
  delivery_updated_at TEXT,
  delivery_updated_by INTEGER,
  idempotency_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_sperson_id ON orders(sperson_id);
CREATE INDEX IF NOT EXISTS idx_orders_cluster_id ON orders(cluster_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_agent_id ON orders(delivery_agent_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  cust_price REAL NOT NULL DEFAULT 0,
  act_price REAL NOT NULL DEFAULT 0,
  item_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE TABLE IF NOT EXISTS manager_assignments (
  manager_id INTEGER NOT NULL,
  agent_id INTEGER NOT NULL,
  PRIMARY KEY (manager_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_assignments_agent ON manager_assignments(agent_id);

CREATE TABLE IF NOT EXISTS sales_targets (
  id INTEGER PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  manager_id INTEGER NOT NULL,
  cluster_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  target_amount REAL NOT NULL DEFAULT 0,
  item_targets_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  updated_by INTEGER,
  UNIQUE(agent_id, period)
);

CREATE INDEX IF NOT EXISTS idx_sales_targets_manager_period ON sales_targets(manager_id, period);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT PRIMARY KEY,
  pages_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  admin_id INTEGER NOT NULL,
  admin_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  is_dev_admin INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  user_agent TEXT DEFAULT '',
  ip_address TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY,
  identifier TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  attempted_at BIGINT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_id_time ON login_attempts(identifier, attempted_at);
