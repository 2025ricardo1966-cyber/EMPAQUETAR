-- B1-25: Super Admin platform columns (suspension + activation-code metadata).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at BIGINT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_by TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reactivated_at BIGINT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reactivated_by TEXT;
CREATE INDEX IF NOT EXISTS tenants_status ON tenants (status);

ALTER TABLE tenant_activation_codes ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE tenant_activation_codes ADD COLUMN IF NOT EXISTS generated_by TEXT;
ALTER TABLE tenant_activation_codes ADD COLUMN IF NOT EXISTS invalidated_at BIGINT;
