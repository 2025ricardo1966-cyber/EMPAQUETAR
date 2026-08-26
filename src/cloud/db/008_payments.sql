-- B1-24: online payments (MercadoPago + Stripe) — extend PaymentRecord, PaymentAttempt log.
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
