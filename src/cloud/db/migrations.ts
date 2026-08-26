export const CONTROL_PLANE_MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '001_init.sql',
    sql: `
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
`,
  },
  {
    id: '002_workflows.sql',
    sql: `
CREATE TABLE IF NOT EXISTS workflows (
  workflow_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflows_tenant ON workflows (tenant_id);
CREATE TABLE IF NOT EXISTS workflow_instances (
  instance_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_instances_order ON workflow_instances (order_id);
CREATE INDEX IF NOT EXISTS workflow_instances_tenant ON workflow_instances (tenant_id);
`,
  },
  {
    id: '003_notifications.sql',
    sql: `
CREATE TABLE IF NOT EXISTS notifications (
  notification_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  type TEXT NOT NULL,
  entity_id TEXT,
  audience TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications (tenant_id, recipient_id, dedupe_key);
CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications (tenant_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_audience ON notifications (audience, recipient_id);
`,
  },
  {
    id: '004_auth_rbac.sql',
    sql: `
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
`,
  },
  {
    id: '005_client_portal.sql',
    sql: `
CREATE TABLE IF NOT EXISTS order_files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  uploaded_at BIGINT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_files_tenant_order ON order_files (tenant_id, order_id);
CREATE TABLE IF NOT EXISTS payment_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_records_order ON payment_records (order_id);
CREATE INDEX IF NOT EXISTS payment_records_tenant_order ON payment_records (tenant_id, order_id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id TEXT;
`,
  },
  {
    id: '006_workspace.sql',
    sql: `
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
`,
  },
  {
    id: '007_email.sql',
    sql: `
CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  event_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_logs_tenant_order ON email_logs (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS email_logs_status ON email_logs (status);
`,
  },
  {
    id: '008_payments.sql',
    sql: `
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS gateway TEXT;
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS gateway_order_id TEXT;
CREATE INDEX IF NOT EXISTS payment_records_gateway_order ON payment_records (gateway_order_id);
CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  payment_record_id TEXT NOT NULL,
  gateway TEXT NOT NULL,
  gateway_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  processed_at BIGINT NOT NULL,
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_event ON payment_attempts (gateway, gateway_event_id);
CREATE INDEX IF NOT EXISTS payment_attempts_tenant_order ON payment_attempts (tenant_id, order_id);
`,
  },
  {
    id: '009_super_admin.sql',
    sql: `
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
`,
  },
  {
    id: '010_admin_config.sql',
    sql: `
ALTER TABLE tenant_configs ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS updated_by TEXT;
`,
  },
  {
    id: '011_i18n_messages.sql',
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_language TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
CREATE TABLE IF NOT EXISTS client_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  subject TEXT NOT NULL,
  order_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  resolved_at BIGINT,
  resolved_by TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS client_messages_tenant_customer ON client_messages (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS client_messages_tenant_status ON client_messages (tenant_id, status);
CREATE TABLE IF NOT EXISTS message_entries (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_entries_message ON message_entries (message_id);
`,
  },
  {
    id: '012_order_fulfillment.sql',
    sql: `
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_mode TEXT;
`,
  },
  {
    id: '013_membership_workshop_catalog.sql',
    sql: `
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
`,
  },
  {
    id: '014_security.sql',
    sql: `
CREATE TABLE IF NOT EXISTS security_blocks (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  until_ts BIGINT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS security_blocks_subject ON security_blocks (subject_type, subject_id);
CREATE TABLE IF NOT EXISTS platform_security_config (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
`,
  },
  {
    id: '015_ora_capability_jobs.sql',
    sql: `
CREATE TABLE IF NOT EXISTS capability_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS capability_jobs_tenant ON capability_jobs (tenant_id, capability);
`,
  },
];
