-- LineCart Schema Migration (005_payment_collection.sql)
-- Adds payment tracking columns to orders table to keep delivery completion separate from payment status.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'Not collected';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_amount_collected REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_balance_due REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_collected_at TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_collected_by INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_collected_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);

-- Safely backfill balance_due for existing orders without inventing past collections
UPDATE orders
SET payment_balance_due = total - COALESCE(payment_amount_collected, 0)
WHERE payment_balance_due IS NULL OR (payment_balance_due = 0 AND payment_amount_collected = 0 AND total > 0);
