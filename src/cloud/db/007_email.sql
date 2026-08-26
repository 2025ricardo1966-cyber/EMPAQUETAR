-- B1-23: transactional email logs (Resend). Tenant email settings live in TenantConfig JSON.
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
