import { createHash, randomInt, randomUUID } from 'crypto';
import type { AuthContext, PersistedUser } from '../../contracts/admin-domain';
import { AccessDeniedError } from '../../contracts/admin-domain';
import { assertSuperAdmin } from '../../contracts/platform-domain';
import type { PlatformAuditEntry } from '../../contracts/platform-domain';
import {
  abuseRisk,
  authorizationRisk,
  failedAuthRisk,
  isSensitiveMembershipPath,
  isSensitivePricingOrPermPath,
  looksLikeResourceEnum,
  manipulationRisk,
  maxRisk,
  pruneWindow,
  riskRank,
  type RiskLevel,
} from '../../contracts/security-risk';
import {
  assertE164,
  defaultSecurityPolicy,
  SecurityBlockedError,
  stripSecrets,
  type SecurityBlockRow,
  type SecurityIncident,
  type SecurityMeasure,
  type SecurityPolicy,
  type WhatsAppAlertPref,
  type WhatsAppProvider,
} from '../../contracts/security-domain';
import type { ControlPlaneStore } from '../../cloud/store/ControlPlaneStore';
import type { ControlPlaneEnv } from '../../cloud/env';
import type { TraceService } from './TraceService';
import type { EmailService } from './email/EmailService';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import { t } from '../../i18n';

type WindowRow = { at: number; kind: string; path?: string };

export class SecurityLayer {
  private windows = new Map<string, WindowRow[]>();
  private policy: SecurityPolicy;
  whatsapp: WhatsAppProvider;
  sentWhatsApp: Array<{ to: string; message: string }> = [];

  constructor(
    private store: ControlPlaneStore,
    private tracer: TraceService,
    private email: EmailService,
    whatsapp: WhatsAppProvider,
    private env: ControlPlaneEnv
  ) {
    this.whatsapp = whatsapp;
    this.policy = defaultSecurityPolicy({
      SECURITY_AUTO_BLOCK_ENABLED: env.securityAutoBlockEnabled ? 'true' : 'false',
      SECURITY_WINDOW_MINUTES: String(env.securityWindowMinutes),
      SECURITY_BLOCK_DURATION_MINUTES: String(env.securityBlockDurationMinutes),
    });
  }

  setWhatsApp(provider: WhatsAppProvider) {
    this.whatsapp = provider;
  }

  async load(): Promise<void> {
    const stored = await this.store.getSecurityPolicy();
    if (stored) this.policy = { ...this.policy, ...stored };
  }

  getPolicy(): SecurityPolicy {
    return { ...this.policy };
  }

  async setPolicy(ctx: AuthContext, patch: Partial<SecurityPolicy>): Promise<SecurityPolicy> {
    assertSuperAdmin(ctx.roleId);
    this.policy = { ...this.policy, ...patch };
    await this.store.saveSecurityPolicy(this.policy);
    await this.audit(ctx, 'security.config', 'ok', { event: 'CONFIG_UPDATED' });
    return this.getPolicy();
  }

  async assertNotBlocked(input: { ip: string; userId?: string; sessionId?: string }): Promise<void> {
    const now = Date.now();
    const rows = await this.store.listSecurityBlocks();
    for (const row of rows) {
      if (row.unlockedAt) continue;
      if (row.until <= now) continue;
      const hit =
        (row.subjectType === 'ip' && row.subjectId === input.ip) ||
        (row.subjectType === 'user' && input.userId && row.subjectId === input.userId) ||
        (row.subjectType === 'session' && input.sessionId && row.subjectId === input.sessionId);
      if (hit) throw new SecurityBlockedError(row.until);
    }
  }

  async noteAuthFailure(input: { ip: string; unknownAccount: boolean; userId?: string; tenantId?: string }): Promise<RiskLevel> {
    const now = Date.now();
    this.push(input.ip, { at: now, kind: input.unknownAccount ? 'auth_unknown' : 'auth_fail' });
    const rows = this.window(input.ip, now);
    const failed = rows.filter((r) => r.kind === 'auth_fail' || r.kind === 'auth_unknown').length;
    const unknown = rows.filter((r) => r.kind === 'auth_unknown').length;
    const level = failedAuthRisk(failed, unknown, {
      r1: this.policy.failedLogin1,
      r2: this.policy.failedLogin2,
      r3: this.policy.failedLogin3,
    });
    await this.maybeIncident({
      level,
      ip: input.ip,
      userId: input.userId,
      tenantId: input.tenantId,
      event: input.unknownAccount ? 'AUTH_UNKNOWN_ACCOUNT' : 'AUTH_FAILED',
      endpoint: '/auth/login',
      action: 'login',
      result: 'denied',
    });
    return level;
  }

  async observe(input: {
    ip: string;
    method: string;
    path: string;
    status: number;
    role?: string;
    userId?: string;
    tenantId?: string;
  }): Promise<RiskLevel> {
    if (input.path === '/health' || input.path === '/ready' || input.path === '/contract') return 'RIESGO_0';
    const now = Date.now();
    const key = input.userId || input.ip;
    this.push(key, { at: now, kind: 'req', path: input.path });
    if (input.status === 401 || input.status === 403 || input.status === 404) {
      this.push(key, { at: now, kind: `http_${input.status}`, path: input.path });
    }
    const rows = this.window(key, now);
    const denied = rows.filter((r) => r.kind === 'http_403').length;
    const notFound = new Set(rows.filter((r) => r.kind === 'http_404' && looksLikeResourceEnum(r.path || '')).map((r) => r.path || '')).size;
    const reqs = rows.filter((r) => r.kind === 'req').length;
    const clientHitAdmin = input.role === 'CUSTOMER' && input.path.startsWith('/admin') && input.status === 403;
    let crossTenant = false;
    if (input.role && input.role !== 'CUSTOMER' && input.role !== 'SUPER_ADMIN' && input.status === 403) {
      const cust = input.path.match(/^\/admin\/customers\/([^/]+)/);
      if (cust && input.tenantId) {
        const row = await this.store.getCustomer(cust[1]);
        if (row && row.tenantId !== input.tenantId) crossTenant = true;
      }
    }
    if (crossTenant) this.push(key, { at: now, kind: 'cross_tenant', path: input.path });
    const crosses = this.window(key, now).filter((r) => r.kind === 'cross_tenant').length;
    const mutating = input.method !== 'GET' && input.method !== 'HEAD' && input.status === 403;
    const membership = mutating && isSensitiveMembershipPath(input.path);
    const pricing = mutating && isSensitivePricingOrPermPath(input.path);
    if (mutating) this.push(key, { at: now, kind: 'mutate_denied', path: input.path });
    const outOfRole = this.window(key, now).filter((r) => r.kind === 'mutate_denied').length;
    const level = maxRisk([
      authorizationRisk({ clientHitAdmin, accessDeniedCount: denied, crossTenantAttempt: crossTenant }),
      manipulationRisk({
        membershipWithoutPerm: membership,
        pricingOrPermissionsWithoutPerm: pricing,
        outOfRoleMutations: outOfRole,
      }),
      abuseRisk({
        requestCount: reqs,
        volumeThreshold: this.policy.volumeThreshold,
        distinctNotFound: notFound,
        enumThreshold: this.policy.enumThreshold,
      }),
    ]);
    await this.maybeIncident({
      level,
      ip: input.ip,
      userId: input.userId,
      tenantId: input.tenantId,
      skipAutoBlock: crossTenant && crosses < 2,
      event: crossTenant
        ? 'CROSS_TENANT'
        : clientHitAdmin
          ? 'CLIENT_ADMIN_PATH'
          : membership
            ? 'MEMBERSHIP_FORBIDDEN'
            : pricing
              ? 'PRICING_OR_PERM_FORBIDDEN'
              : input.status === 404
                ? 'NOT_FOUND'
                : 'ACCESS_DENIED',
      endpoint: input.path,
      action: input.method,
      result: String(input.status),
    });
    return level;
  }

  async listIncidents(ctx: AuthContext, query: { level?: string; tenantId?: string; from?: number; to?: number }): Promise<SecurityIncident[]> {
    const all = await this.store.listPlatformAudit();
    const rows = all
      .filter((e) => e.action === 'security.incident' || e.kind === 'security_incident')
      .map((e) => this.toIncident(e))
      .filter((e) => {
        if (query.level && e.nivel_riesgo !== query.level) return false;
        if (query.tenantId && e.tenant_id !== query.tenantId) return false;
        if (query.from && e.fecha_hora < query.from) return false;
        if (query.to && e.fecha_hora > query.to) return false;
        return true;
      });
    if (ctx.roleId === 'SUPER_ADMIN') return rows.reverse();
    return rows.filter((e) => e.tenant_id === ctx.tenantId).reverse();
  }

  async listBlocks(ctx: AuthContext): Promise<SecurityBlockRow[]> {
    assertSuperAdmin(ctx.roleId);
    const now = Date.now();
    return (await this.store.listSecurityBlocks()).filter((b) => !b.unlockedAt && b.until > now);
  }

  async unlock(ctx: AuthContext, blockId: string): Promise<SecurityBlockRow> {
    assertSuperAdmin(ctx.roleId);
    const rows = await this.store.listSecurityBlocks();
    const row = rows.find((b) => b.id === blockId);
    if (!row) throw new AccessDeniedError();
    const next = { ...row, unlockedAt: Date.now(), unlockedBy: ctx.userId };
    await this.store.saveSecurityBlock(next);
    await this.audit(ctx, 'security.unlock', 'ok', {
      event: 'UNLOCK',
      superAdminActorId: ctx.userId,
      usuarioId: row.subjectId,
    });
    return next;
  }

  async saveWhatsApp(
    ctx: AuthContext,
    input: { whatsappNumber?: string; whatsappAlerts?: WhatsAppAlertPref }
  ): Promise<{ whatsappNumber?: string; whatsappVerified: boolean; whatsappAlerts: WhatsAppAlertPref }> {
    const user = await this.requireStaffProfile(ctx);
    if (input.whatsappAlerts) user.whatsappAlerts = input.whatsappAlerts;
    if (input.whatsappNumber != null && input.whatsappNumber !== '') {
      try {
        user.whatsappNumber = assertE164(input.whatsappNumber);
      } catch {
        throw new RequestInvalidError('INVALID_WHATSAPP_NUMBER');
      }
      user.whatsappVerified = false;
      const code = String(randomInt(100000, 1000000));
      user.whatsappVerifyHash = createHash('sha256').update(code).digest('hex');
      user.whatsappVerifyExpiresAt = Date.now() + 15 * 60 * 1000;
      await this.persistUser(user);
      const msg = t('security.whatsapp_verify', ctx.lang || 'es', { code });
      await this.dispatchWhatsApp(user.whatsappNumber, msg);
    } else {
      await this.persistUser(user);
    }
    return {
      whatsappNumber: user.whatsappNumber,
      whatsappVerified: !!user.whatsappVerified,
      whatsappAlerts: user.whatsappAlerts || 'CRITICAL_ONLY',
    };
  }

  async verifyWhatsApp(ctx: AuthContext, code: string): Promise<{ verified: boolean }> {
    const user = await this.requireStaffProfile(ctx);
    const hash = createHash('sha256').update(String(code || '').trim()).digest('hex');
    if (!user.whatsappVerifyHash || user.whatsappVerifyHash !== hash) throw new AccessDeniedError();
    if (!user.whatsappVerifyExpiresAt || user.whatsappVerifyExpiresAt < Date.now()) throw new AccessDeniedError();
    user.whatsappVerified = true;
    user.whatsappVerifyHash = null;
    user.whatsappVerifyExpiresAt = null;
    await this.persistUser(user);
    return { verified: true };
  }

  async getWhatsApp(ctx: AuthContext) {
    const user = await this.requireStaffProfile(ctx);
    return {
      whatsappNumber: user.whatsappNumber || '',
      whatsappVerified: !!user.whatsappVerified,
      whatsappAlerts: user.whatsappAlerts || 'CRITICAL_ONLY',
    };
  }

  private async requireStaffProfile(ctx: AuthContext): Promise<PersistedUser> {
    if (ctx.roleId === 'SUPER_ADMIN') {
      const row = await this.store.getSuperAdmin(ctx.userId);
      if (!row) throw new AccessDeniedError();
      return row;
    }
    if (!['ADMIN_PRINCIPAL', 'ADMIN', 'SUBADMIN'].includes(ctx.roleId)) throw new AccessDeniedError();
    const row = await this.store.getUser(ctx.userId);
    if (!row || row.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    return row;
  }

  private async persistUser(user: PersistedUser) {
    if (user.roleId === 'SUPER_ADMIN') await this.store.saveSuperAdmin(user);
    else await this.store.saveUser(user);
  }

  private windowMs() {
    return this.policy.windowMinutes * 60 * 1000;
  }

  private push(key: string, row: WindowRow) {
    const now = row.at;
    const next = pruneWindow([...(this.windows.get(key) || []), row], now, this.windowMs());
    this.windows.set(key, next);
  }

  private window(key: string, now: number) {
    const next = pruneWindow(this.windows.get(key) || [], now, this.windowMs());
    this.windows.set(key, next);
    return next;
  }

  private async maybeIncident(input: {
    level: RiskLevel;
    ip: string;
    userId?: string;
    tenantId?: string;
    event: string;
    endpoint: string;
    action: string;
    result: string;
    skipAutoBlock?: boolean;
  }) {
    if (riskRank(input.level) < 1) return;
    let measure: SecurityMeasure = 'recorded';
    let duration: number | undefined;
    const exempt =
      (input.userId && this.policy.exemptUserIds.includes(input.userId)) ||
      (input.tenantId && this.policy.exemptTenantIds.includes(input.tenantId));
    const shouldBlock =
      this.policy.autoBlockEnabled &&
      !exempt &&
      !input.skipAutoBlock &&
      riskRank(input.level) >= riskRank(this.policy.autoBlockFromLevel);
    if (shouldBlock) {
      duration = this.policy.blockMinutes * 60 * 1000;
      const until = Date.now() + duration;
      if (input.userId) {
        await this.store.saveSecurityBlock({
          id: randomUUID(),
          subjectType: 'user',
          subjectId: input.userId,
          tenantId: input.tenantId,
          riskLevel: input.level,
          startedAt: Date.now(),
          until,
          reason: input.event,
        });
      } else {
        await this.store.saveSecurityBlock({
          id: randomUUID(),
          subjectType: 'ip',
          subjectId: input.ip,
          tenantId: input.tenantId,
          riskLevel: input.level,
          startedAt: Date.now(),
          until,
          reason: input.event,
        });
      }
      measure = input.level === 'RIESGO_4' ? 'blocked_notified' : 'blocked';
    }
    if (input.level === 'RIESGO_1' || input.level === 'RIESGO_2') measure = measure === 'recorded' ? 'in_app' : measure;
    if (input.level === 'RIESGO_3' || input.level === 'RIESGO_4') {
      if (measure === 'recorded') measure = 'in_app';
    }
    const incident: SecurityIncident = stripSecrets({
      id: randomUUID(),
      fecha_hora: Date.now(),
      usuario_id: input.userId,
      tenant_id: input.tenantId,
      ip: input.ip,
      evento: input.event,
      endpoint: input.endpoint,
      accion_intentada: input.action,
      resultado: input.result,
      nivel_riesgo: input.level,
      medida_aplicada: measure,
      duracion_bloqueo: duration,
    });
    await this.store.appendPlatformAudit({
      id: incident.id,
      timestamp: incident.fecha_hora,
      actorId: input.userId || '',
      actorRole: 'SYSTEM',
      tenantId: input.tenantId || '',
      action: 'security.incident',
      kind: 'security_incident',
      event: incident.evento,
      endpoint: incident.endpoint,
      attemptedAction: incident.accion_intentada,
      riskLevel: incident.nivel_riesgo,
      measure: incident.medida_aplicada,
      blockDurationMs: duration,
      ip: incident.ip,
      usuarioId: incident.usuario_id,
      result: 'denied',
      reason: incident.evento,
    });
    await this.notify(incident);
  }

  private async notify(incident: SecurityIncident) {
    const title = t('security.alert_title', 'es', { level: incident.nivel_riesgo });
    const message = t('security.alert_body', 'es', { event: incident.evento, endpoint: incident.endpoint });
    if (incident.tenant_id) {
      await this.tracer.notifyOperational({
        tenantId: incident.tenant_id,
        type: 'SECURITY_ALERT',
        title,
        workshopMessage: message,
        entityType: 'config',
        entityId: incident.id,
        dedupeKey: `${incident.id}:SECURITY_ALERT`,
        includeWorkshop: true,
        workshopOnlyAdmins: true,
      });
    }
    await this.tracer.notifyPlatform({
      tenantId: incident.tenant_id || 'platform',
      type: 'SECURITY_ALERT',
      title,
      message,
      entityId: incident.id,
      dedupeKey: `${incident.id}:SECURITY_PLATFORM`,
    });
    const external = incident.nivel_riesgo === 'RIESGO_3' || incident.nivel_riesgo === 'RIESGO_4';
    if (!external) return;
    const targets = await this.alertRecipients(incident);
    for (const person of targets) {
      if (this.email.getTransport() && person.email) {
        await this.email.send({
          to: person.email,
          subject: title,
          html: `<p>${message}</p>`,
          tenantId: incident.tenant_id || 'platform',
          eventType: 'SECURITY_ALERT',
          recipientId: person.userId,
        });
      }
      if (person.whatsappNumber && person.whatsappVerified && this.allowWhatsApp(person.whatsappAlerts, incident.nivel_riesgo)) {
        await this.dispatchWhatsApp(person.whatsappNumber, message);
      }
    }
  }

  private allowWhatsApp(pref: WhatsAppAlertPref | undefined, level: RiskLevel) {
    const mode = pref || 'CRITICAL_ONLY';
    if (mode === 'NONE') return false;
    if (mode === 'CRITICAL_ONLY') return level === 'RIESGO_4';
    return level === 'RIESGO_3' || level === 'RIESGO_4';
  }

  private async dispatchWhatsApp(to: string, message: string) {
    this.sentWhatsApp.push({ to, message });
    await this.whatsapp.send(to, message);
  }

  private async alertRecipients(incident: SecurityIncident) {
    const out: Array<{
      userId: string;
      email?: string;
      whatsappNumber?: string;
      whatsappVerified?: boolean;
      whatsappAlerts?: WhatsAppAlertPref;
    }> = [];
    if (incident.tenant_id) {
      const users = await this.store.listUsers(incident.tenant_id);
      for (const u of users) {
        if (u.roleId === 'ADMIN_PRINCIPAL' || u.roleId === 'ADMIN') {
          out.push({
            userId: u.userId,
            email: u.email || u.login,
            whatsappNumber: u.whatsappNumber,
            whatsappVerified: u.whatsappVerified,
            whatsappAlerts: u.whatsappAlerts,
          });
        }
      }
    }
    for (const u of await this.store.listSuperAdmins()) {
      out.push({
        userId: u.userId,
        email: u.email || u.login,
        whatsappNumber: u.whatsappNumber,
        whatsappVerified: u.whatsappVerified,
        whatsappAlerts: u.whatsappAlerts,
      });
    }
    return out;
  }

  private toIncident(e: PlatformAuditEntry): SecurityIncident {
    return {
      id: e.id,
      fecha_hora: e.timestamp,
      usuario_id: e.usuarioId,
      tenant_id: e.tenantId || undefined,
      ip: e.ip,
      evento: e.event || e.reason || e.action,
      endpoint: e.endpoint || '',
      accion_intentada: e.attemptedAction || '',
      resultado: e.result,
      nivel_riesgo: (e.riskLevel as RiskLevel) || 'RIESGO_1',
      medida_aplicada: (e.measure as SecurityMeasure) || 'recorded',
      duracion_bloqueo: e.blockDurationMs,
      super_admin_que_intervino: e.superAdminActorId,
    };
  }

  private async audit(ctx: AuthContext, action: string, result: PlatformAuditEntry['result'], extra: Partial<PlatformAuditEntry>) {
    await this.store.appendPlatformAudit({
      id: randomUUID(),
      timestamp: Date.now(),
      actorId: ctx.userId,
      actorRole: ctx.roleId,
      tenantId: ctx.tenantId,
      action,
      result,
      ...extra,
    });
  }
}
