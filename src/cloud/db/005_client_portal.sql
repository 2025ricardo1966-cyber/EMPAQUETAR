-- B1-21: client portal — Customer extensions live in customers.payload;
-- Order.customer_id already exists. Dedicated payment and file tables.
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
