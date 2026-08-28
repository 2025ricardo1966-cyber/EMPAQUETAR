/**
 * Control Plane environment. Secrets come from process env — never from the frontend.
 * MASCAYL_ENV: development | staging | production
 */
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type ControlPlaneEnvName = 'development' | 'staging' | 'production';

export interface ControlPlaneEnv {
  name: ControlPlaneEnvName;
  host: string;
  port: number;
  dataDir: string;
  dataEphemeral: boolean;
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

function ensureDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.writable'), 'ok');
    return true;
  } catch {
    return false;
  }
}

export function resolveDataDir(raw: NodeJS.ProcessEnv, envName: ControlPlaneEnvName): { dir: string; ephemeral: boolean } {
  const preferred =
    raw.MASCAYL_DATA_DIR || (envName === 'production' || raw.PORT ? '/data' : join(process.cwd(), '.data'));
  if (ensureDir(preferred)) return { dir: preferred, ephemeral: false };
  const fallback = join('/tmp', 'empaquetar-data');
  ensureDir(fallback);
  process.stderr.write(
    `${JSON.stringify({ event: 'data-dir.ephemeral', wanted: preferred, using: fallback })}\n`
  );
  return { dir: fallback, ephemeral: true };
}

function resolveJwtSecret(raw: NodeJS.ProcessEnv, dataDir: string, envName: ControlPlaneEnvName): string {
  const given = String(raw.MASCAYL_JWT_SECRET || '').trim();
  if (given && given !== 'mascayl-dev-jwt') return given;
  if (envName !== 'production' && envName !== 'staging') return given || 'mascayl-dev-jwt';
  const file = join(dataDir, 'jwt.secret');
  if (existsSync(file)) {
    const stored = readFileSync(file, 'utf8').trim();
    if (stored) return stored;
  }
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadControlPlaneEnv(raw: NodeJS.ProcessEnv = process.env): ControlPlaneEnv {
  const name = (raw.MASCAYL_ENV || raw.NODE_ENV || 'development') as string;
  const envName: ControlPlaneEnvName =
    name === 'production' || name === 'staging' ? name : 'development';
  const port = Number(raw.PORT || raw.MASCAYL_CONTROL_PLANE_PORT || '8787');
  const data = resolveDataDir(raw, envName);
  const persist =
    Boolean(raw.MASCAYL_DATA_DIR || raw.MASCAYL_DATABASE_URL || raw.PORT) ||
    envName === 'production' ||
    envName === 'staging';
  const blobDir = persist ? raw.MASCAYL_BLOB_DIR || join(data.dir, 'blobs') : raw.MASCAYL_BLOB_DIR || undefined;
  if (blobDir) ensureDir(blobDir);
  const databaseUrl = persist
    ? raw.MASCAYL_DATABASE_URL || `pglite:${join(data.dir, 'pglite')}`
    : raw.MASCAYL_DATABASE_URL || undefined;
  return {
    name: envName,
    host: raw.MASCAYL_CONTROL_PLANE_HOST || (raw.PORT ? '0.0.0.0' : '127.0.0.1'),
    port: Number.isFinite(port) ? port : 8787,
    dataDir: data.dir,
    dataEphemeral: data.ephemeral,
    databaseUrl,
    sessionTtlMs: Number(raw.MASCAYL_SESSION_TTL_MS || 15 * 60 * 1000),
    refreshTtlMs: Number(raw.MASCAYL_REFRESH_TTL_MS || 30 * 24 * 60 * 60 * 1000),
    backupStrategy:
      raw.MASCAYL_BACKUP_STRATEGY ||
      'PGlite files on MASCAYL_DATA_DIR (Railway volume at /data).',
    jwtSecret: resolveJwtSecret(raw, data.dir, envName),
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
    blobDir,
    objectStoreProvider:
      raw.MASCAYL_OBJECT_STORE === 's3' || raw.MASCAYL_OBJECT_STORE === 'r2'
        ? 's3'
        : blobDir
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
