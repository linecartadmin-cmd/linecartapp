-- LineCart Migration 006: Order Location, Visit Photo, and Expected Delivery Date
-- Adds foreground GPS coordinates, visit photo attachment metadata, and expected delivery date to orders.
-- Safely preserves all existing customer and order records without altering delivery status.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_lat REAL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_lng REAL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_accuracy REAL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_text TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS visit_photo TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS visit_photo_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS visit_photo_updated_at TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expected_delivery_date TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_expected_delivery_date ON orders(expected_delivery_date);
