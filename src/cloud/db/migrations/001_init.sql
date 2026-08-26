-- 001_init.sql — Control Plane source of truth (PostgreSQL-compatible)

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  login TEXT NOT NULL,
  role_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS users_tenant_login ON users (tenant_id, login);
CREATE INDEX IF NOT EXISTS users_login ON users (login);

CREATE TABLE IF NOT EXISTS super_admins (
  user_id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_configs (
  tenant_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  login TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS customers_tenant ON customers (tenant_id);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  due_at BIGINT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_tenant ON orders (tenant_id);

CREATE TABLE IF NOT EXISTS order_snapshots (
  order_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  captured_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS processes (
  instance_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS processes_tenant ON processes (tenant_id);
CREATE INDEX IF NOT EXISTS processes_order ON processes (order_id);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  process_instance_id TEXT,
  status TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_tenant ON jobs (tenant_id);

CREATE TABLE IF NOT EXISTS workers (
  worker_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  token_hash TEXT,
  payload TEXT NOT NULL,
  last_heartbeat BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  job_id TEXT,
  storage_reference TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blobs (
  blob_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  kind TEXT NOT NULL,
  bytes TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  ts BIGINT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_tenant ON audit_events (tenant_id);

CREATE TABLE IF NOT EXISTS platform_audit (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  ts BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  refresh_hash TEXT,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  permissions TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  refresh_expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS customer_files (
  file_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_override (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
