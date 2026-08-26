/**
 * Control Plane environment. Secrets come from process env — never from the frontend.
 * MASCAYL_ENV: development | staging | production
 */
export type ControlPlaneEnvName = 'development' | 'staging' | 'production';

export interface ControlPlaneEnv {
  name: ControlPlaneEnvName;
  host: string;
  port: number;
  databaseUrl?: string;
  sessionTtlMs: number;
  refreshTtlMs: number;
  backupStrategy: string;
  jwtSecret: string;
  resendApiKey?: string;
  emailFromDefault: string;
  emailAppUrl?: string;
  mpAccessToken?: string;
  mpWebhookSecret?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  paymentSuccessUrl?: string;
  paymentFailureUrl?: string;
  paymentPendingUrl?: string;
  paymentLive?: boolean;
  superAdminEmail?: string;
  superAdminPassword?: string;
  securityBlockDurationMinutes: number;
  securityWindowMinutes: number;
  securityAutoBlockEnabled: boolean;
  whatsappProvider?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioWhatsappFrom?: string;
  blobDir?: string;
  objectStoreProvider: 'sql' | 'filesystem' | 's3';
}

export function loadControlPlaneEnv(raw: NodeJS.ProcessEnv = process.env): ControlPlaneEnv {
  const name = (raw.MASCAYL_ENV || raw.NODE_ENV || 'development') as string;
  const envName: ControlPlaneEnvName =
    name === 'production' || name === 'staging' ? name : 'development';
  const port = Number(raw.MASCAYL_CONTROL_PLANE_PORT || '8787');
  return {
    name: envName,
    host: raw.MASCAYL_CONTROL_PLANE_HOST || '127.0.0.1',
    port: Number.isFinite(port) ? port : 8787,
    databaseUrl: raw.MASCAYL_DATABASE_URL || undefined,
    sessionTtlMs: Number(raw.MASCAYL_SESSION_TTL_MS || 15 * 60 * 1000),
    refreshTtlMs: Number(raw.MASCAYL_REFRESH_TTL_MS || 30 * 24 * 60 * 60 * 1000),
    backupStrategy:
      raw.MASCAYL_BACKUP_STRATEGY ||
      'Use the managed PostgreSQL provider point-in-time backup (Neon/RDS/Cloud SQL). Do not copy production with ad-hoc scripts.',
    jwtSecret: raw.MASCAYL_JWT_SECRET || 'mascayl-dev-jwt',
    resendApiKey: raw.RESEND_API_KEY || undefined,
    emailFromDefault: raw.EMAIL_FROM_DEFAULT || 'EMPAQUETAR <noreply@empaquetar.app>',
    emailAppUrl: raw.EMAIL_APP_URL || raw.MASCAYL_APP_URL || undefined,
    mpAccessToken: raw.MP_ACCESS_TOKEN || undefined,
    mpWebhookSecret: raw.MP_WEBHOOK_SECRET || undefined,
    stripeSecretKey: raw.STRIPE_SECRET_KEY || undefined,
    stripeWebhookSecret: raw.STRIPE_WEBHOOK_SECRET || undefined,
    paymentSuccessUrl: raw.PAYMENT_SUCCESS_URL || undefined,
    paymentFailureUrl: raw.PAYMENT_FAILURE_URL || undefined,
    paymentPendingUrl: raw.PAYMENT_PENDING_URL || undefined,
    paymentLive: raw.PAYMENT_LIVE === '1' || raw.PAYMENT_LIVE === 'true',
    superAdminEmail: raw.SUPER_ADMIN_EMAIL || undefined,
    superAdminPassword: raw.SUPER_ADMIN_PASSWORD || undefined,
    securityBlockDurationMinutes: Number(raw.SECURITY_BLOCK_DURATION_MINUTES || 15) || 15,
    securityWindowMinutes: Number(raw.SECURITY_WINDOW_MINUTES || 15) || 15,
    securityAutoBlockEnabled: raw.SECURITY_AUTO_BLOCK_ENABLED !== '0' && raw.SECURITY_AUTO_BLOCK_ENABLED !== 'false',
    whatsappProvider: raw.WHATSAPP_PROVIDER || undefined,
    twilioAccountSid: raw.TWILIO_ACCOUNT_SID || undefined,
    twilioAuthToken: raw.TWILIO_AUTH_TOKEN || undefined,
    twilioWhatsappFrom: raw.TWILIO_WHATSAPP_FROM || undefined,
    blobDir: raw.MASCAYL_BLOB_DIR || undefined,
    objectStoreProvider:
      raw.MASCAYL_OBJECT_STORE === 's3' || raw.MASCAYL_OBJECT_STORE === 'r2'
        ? 's3'
        : raw.MASCAYL_BLOB_DIR
          ? 'filesystem'
          : 'sql',
  };
}

export function assertNoSecretsInPayload(payload: unknown): void {
  const text = JSON.stringify(payload || {});
  if (/password|refreshToken|MASCAYL_DATABASE_URL/i.test(text) && /"password"\s*:\s*"[^"]+"/.test(text)) {
    /* login requests include password once; handlers must strip before logging */
  }
}
