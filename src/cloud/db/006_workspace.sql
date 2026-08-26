-- B1-22: workshop workspace — internal comments, assignments, CDR conversion metadata.
CREATE TABLE IF NOT EXISTS internal_comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS internal_comments_tenant_order ON internal_comments (tenant_id, order_id);
CREATE TABLE IF NOT EXISTS order_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  assigned_to TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at BIGINT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_assignments_tenant ON order_assignments (tenant_id);
ALTER TABLE order_files ADD COLUMN IF NOT EXISTS converted_key TEXT;
ALTER TABLE order_files ADD COLUMN IF NOT EXISTS conversion_status TEXT;
ALTER TABLE order_files ADD COLUMN IF NOT EXISTS color_profile_key TEXT;
