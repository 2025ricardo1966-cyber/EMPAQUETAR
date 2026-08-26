-- B1-20: auth, tenant activation codes, RBAC indexes.
CREATE TABLE IF NOT EXISTS tenant_activation_codes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  tenant_id TEXT,
  used_at BIGINT,
  used_by TEXT,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_activation_codes_code ON tenant_activation_codes (code);
CREATE INDEX IF NOT EXISTS users_tenant_id ON users (tenant_id);
CREATE INDEX IF NOT EXISTS users_email ON users (login);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id TEXT;
