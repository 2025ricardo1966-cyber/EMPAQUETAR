-- B1-28: multi-party fulfillment. Order payload JSON holds destination/roles;
-- tenant clientOptions live on tenant_configs.payload. Optional column for mode queries.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_mode TEXT;
