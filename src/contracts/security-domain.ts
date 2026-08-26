import { BLOCK_DURATION_MINUTES, DEFAULT_BLOCK_MINUTES, DEFAULT_WINDOW_MINUTES, type RiskLevel } from './security-risk';

export type WhatsAppAlertPref = 'CRITICAL_ONLY' | 'ALL' | 'NONE';

export interface WhatsAppProvider {
  send(to: string, message: string): Promise<void>;
}

export class SecurityBlockedError extends Error {
  readonly code = 'SECURITY_BLOCKED';
  readonly until: number;
  constructor(until: number, message?: string) {
    super(message || 'SECURITY_BLOCKED');
    this.name = 'SecurityBlockedError';
    this.until = until;
  }
}

export const E164_PHONE = /^\+[1-9]\d{7,14}$/;

export function assertE164(raw: string): string {
  const value = String(raw || '').trim().replace(/[\s()-]/g, '');
  if (!E164_PHONE.test(value)) {
    const err = new Error('INVALID_WHATSAPP_NUMBER');
    (err as { code?: string }).code = 'INVALID_WHATSAPP_NUMBER';
    throw err;
  }
  return value;
}

export function normalizeBlockMinutes(raw: unknown, fallback = DEFAULT_BLOCK_MINUTES): number {
  const n = Number(raw);
  if ((BLOCK_DURATION_MINUTES as readonly number[]).includes(n)) return n;
  return fallback;
}

export interface SecurityPolicy {
  autoBlockEnabled: boolean;
  windowMinutes: number;
  blockMinutes: number;
  failedLogin1: number;
  failedLogin2: number;
  failedLogin3: number;
  deniedRepeat: number;
  volumeThreshold: number;
  enumThreshold: number;
  autoBlockFromLevel: RiskLevel;
  exemptUserIds: string[];
  exemptTenantIds: string[];
}

export function defaultSecurityPolicy(env?: {
  SECURITY_AUTO_BLOCK_ENABLED?: string;
  SECURITY_WINDOW_MINUTES?: string;
  SECURITY_BLOCK_DURATION_MINUTES?: string;
}): SecurityPolicy {
  const auto = env?.SECURITY_AUTO_BLOCK_ENABLED;
  return {
    autoBlockEnabled: auto !== '0' && auto !== 'false',
    windowMinutes: Number(env?.SECURITY_WINDOW_MINUTES || DEFAULT_WINDOW_MINUTES) || DEFAULT_WINDOW_MINUTES,
    blockMinutes: normalizeBlockMinutes(env?.SECURITY_BLOCK_DURATION_MINUTES, DEFAULT_BLOCK_MINUTES),
    failedLogin1: 3,
    failedLogin2: 5,
    failedLogin3: 10,
    deniedRepeat: 3,
    volumeThreshold: 200,
    enumThreshold: 8,
    autoBlockFromLevel: 'RIESGO_3',
    exemptUserIds: [],
    exemptTenantIds: [],
  };
}

export type SecurityMeasure = 'none' | 'recorded' | 'in_app' | 'blocked' | 'blocked_notified' | 'unlocked';

export interface SecurityIncident {
  id: string;
  fecha_hora: number;
  usuario_id?: string;
  tenant_id?: string;
  ip?: string;
  evento: string;
  endpoint: string;
  accion_intentada: string;
  resultado: string;
  nivel_riesgo: RiskLevel;
  medida_aplicada: SecurityMeasure;
  duracion_bloqueo?: number;
  super_admin_que_intervino?: string;
}

export interface SecurityBlockRow {
  id: string;
  subjectType: 'user' | 'ip' | 'session';
  subjectId: string;
  tenantId?: string;
  riskLevel: RiskLevel;
  startedAt: number;
  until: number;
  reason: string;
  unlockedAt?: number;
  unlockedBy?: string;
}

export function incidentHasSecrets(row: unknown): boolean {
  const text = JSON.stringify(row || {});
  return /"password"\s*:\s*"[^"]+"|"accessToken"\s*:\s*"[^"]+"|"refreshToken"\s*:\s*"[^"]+"|"TWILIO_AUTH_TOKEN"\s*:\s*"[^"]+"/i.test(
    text
  );
}

export function stripSecrets<T>(value: T): T {
  const json = JSON.stringify(value, (key, v) => {
    const k = String(key).toLowerCase();
    if (k.includes('password') || k.includes('token') || k.includes('secret') || k.includes('authorization')) return undefined;
    return v;
  });
  return JSON.parse(json) as T;
}
