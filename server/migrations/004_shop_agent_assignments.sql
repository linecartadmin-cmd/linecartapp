-- LineCart Schema Migration (004_shop_agent_assignments.sql)
-- Adds assigned_agent_id to shops table for Field Sales Agent scoping and manager/admin assignment.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS assigned_agent_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_shops_assigned_agent ON shops(assigned_agent_id);
