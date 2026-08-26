-- B1-26: admin configuration lives in tenant_configs.payload JSON (products.fields, visibility, limits).
-- Workflow presentation fields live in workflows.payload; denormalize operators for ops queries.
ALTER TABLE tenant_configs ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS updated_by TEXT;
