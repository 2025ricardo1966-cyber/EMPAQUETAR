-- B1-49/B1-50: membership 1:1 customer; workshop catalog items. Not Prisma — Control Plane SQL.
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  payload TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS memberships_tenant_status ON memberships (tenant_id, status);
CREATE TABLE IF NOT EXISTS workshop_catalog_items (
  item_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  category TEXT NOT NULL,
  stock_enabled INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workshop_catalog_tenant_cat ON workshop_catalog_items (tenant_id, category);
