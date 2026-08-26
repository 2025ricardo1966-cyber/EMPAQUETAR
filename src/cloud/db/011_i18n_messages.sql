-- B1-27: i18n fields on existing JSON payloads + client↔admin message channel.
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
