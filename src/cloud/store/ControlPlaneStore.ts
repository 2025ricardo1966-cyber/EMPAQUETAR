import type {
  AuditEntry,
  AuthContext,
  PersistedUser,
  Tenant,
  TenantConfig,
} from '../../contracts/admin-domain';
import { normalizeTenant } from '../../contracts/admin-domain';
import type { PlatformAuditEntry } from '../../contracts/platform-domain';
import type { SecurityBlockRow, SecurityPolicy } from '../../contracts/security-domain';
import type { PersistedOrder } from '../../contracts/order-domain';
import type {
  ProcessInstance,
  ProductionArtifact,
  ProductionJob,
  WorkerDescriptor,
} from '../../contracts/production-orchestration';
import type { ClientMessage, MessageEntry } from '../../contracts/client-message-domain';
import type { Membership } from '../../contracts/membership-domain';
import type { WorkshopCatalogItem } from '../../contracts/workshop-catalog-domain';
import type {
  CustomerProfile,
  InternalCommentRecord,
  OrderAssignmentRecord,
  OrderFileRecord,
  OrderNotificationEvent,
  PaymentRecord,
} from '../../contracts/customer-experience';
import type { OrderRepository } from '../../main/services/OrderRepository';
import type { PlatformRepository } from '../../main/services/PlatformRepository';
import type { ProductionStore } from '../../main/services/ProductionStore';
import type { CustomerFileRecord, CustomerStore } from '../../main/services/CustomerStore';
import { computeDeadline } from '../../contracts/order-lifecycle';
import { DEFAULT_DEADLINE_POLICY } from '../../contracts/order-domain';
import type { SqlEngine } from '../db/engine';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { WorkflowDefinition, WorkflowInstance } from '../../contracts/workflow-domain';
import type { OperationalNotification } from '../../contracts/trace-domain';
import type { EmailLogRecord } from '../../contracts/email-domain';

function parse<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export interface TenantActivationCodeRow {
  id: string;
  code: string;
  tenantId: string | null;
  usedAt: number | null;
  usedBy: string | null;
  expiresAt: number;
  notes: string | null;
  generatedBy: string | null;
  invalidatedAt: number | null;
}

type ActivationCodeSql = {
  id: string;
  code: string;
  tenant_id: string | null;
  used_at: number | string | null;
  used_by: string | null;
  expires_at: number | string;
  notes: string | null;
  generated_by: string | null;
  invalidated_at: number | string | null;
};

function mapActivationCode(row: ActivationCodeSql): TenantActivationCodeRow {
  return {
    id: row.id,
    code: row.code,
    tenantId: row.tenant_id,
    usedAt: row.used_at == null ? null : Number(row.used_at),
    usedBy: row.used_by,
    expiresAt: Number(row.expires_at),
    notes: row.notes,
    generatedBy: row.generated_by,
    invalidatedAt: row.invalidated_at == null ? null : Number(row.invalidated_at),
  };
}

export interface PersistedSession {
  ctx: AuthContext;
  expiresAt: number;
  refreshExpiresAt: number;
  refreshHash?: string;
}

export class ControlPlaneStore implements PlatformRepository, OrderRepository, ProductionStore, CustomerStore {
  constructor(
    private db: SqlEngine,
    private blobDir?: string
  ) {}

  async getProductOverride(): Promise<{ releaseChannel?: string; versionStatus?: string } | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM product_override WHERE id = $1', [
      'default',
    ]);
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async saveProductOverride(meta: { releaseChannel?: string; versionStatus?: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO product_override (id, payload) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
      ['default', JSON.stringify(meta)]
    );
  }

  async getSuperAdminByLogin(login: string): Promise<PersistedUser | undefined> {
    const needle = login.trim().toLowerCase();
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM super_admins');
    return rows
      .map((r) => parse<PersistedUser>(r.payload))
      .find((u) => u.login.toLowerCase() === needle || String(u.email || '').toLowerCase() === needle);
  }

  async getSuperAdmin(userId: string): Promise<PersistedUser | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM super_admins WHERE user_id = $1', [
      userId,
    ]);
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async saveSuperAdmin(user: PersistedUser): Promise<void> {
    await this.db.query(
      `INSERT INTO super_admins (user_id, login, payload) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET login = EXCLUDED.login, payload = EXCLUDED.payload`,
      [user.userId, user.login, JSON.stringify(user)]
    );
  }

  async listSuperAdmins(): Promise<PersistedUser[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM super_admins');
    return rows.map((r) => parse<PersistedUser>(r.payload));
  }

  async getTenant(tenantId: string): Promise<Tenant | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM tenants WHERE tenant_id = $1', [
      tenantId,
    ]);
    return rows[0] ? normalizeTenant(parse(rows[0].payload)) : undefined;
  }

  async saveTenant(tenant: Tenant): Promise<void> {
    const normalized = normalizeTenant(tenant);
    await this.db.query(
      `INSERT INTO tenants (
         tenant_id, name, payload, created_at, updated_at, status,
         suspended_at, suspended_by, suspension_reason, reactivated_at, reactivated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (tenant_id) DO UPDATE SET
         name = EXCLUDED.name,
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at,
         status = EXCLUDED.status,
         suspended_at = EXCLUDED.suspended_at,
         suspended_by = EXCLUDED.suspended_by,
         suspension_reason = EXCLUDED.suspension_reason,
         reactivated_at = EXCLUDED.reactivated_at,
         reactivated_by = EXCLUDED.reactivated_by`,
      [
        normalized.tenantId,
        normalized.name,
        JSON.stringify(normalized),
        normalized.createdAt,
        normalized.updatedAt,
        normalized.status,
        normalized.suspendedAt ?? null,
        normalized.suspendedBy ?? null,
        normalized.suspensionReason ?? null,
        normalized.reactivatedAt ?? null,
        normalized.reactivatedBy ?? null,
      ]
    );
  }

  async listTenants(): Promise<Tenant[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM tenants ORDER BY created_at');
    return rows.map((r) => normalizeTenant(parse(r.payload)));
  }

  async getUser(userId: string): Promise<PersistedUser | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM users WHERE user_id = $1', [userId]);
    if (rows[0]) return parse(rows[0].payload);
    return this.getSuperAdmin(userId);
  }

  async getUserByLogin(tenantId: string, login: string): Promise<PersistedUser | undefined> {
    const needle = login.trim().toLowerCase();
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM users WHERE tenant_id = $1',
      [tenantId]
    );
    return rows.map((r) => parse<PersistedUser>(r.payload)).find(
      (u) => u.login.toLowerCase() === needle || String(u.email || '').toLowerCase() === needle
    );
  }

  async findUserByLogin(login: string, tenantName?: string): Promise<PersistedUser | undefined> {
    const needle = login.trim().toLowerCase();
    const rows = await this.db.query<{ payload: string; tenant_id: string }>('SELECT payload, tenant_id FROM users');
    const matches = rows
      .map((r) => parse<PersistedUser>(r.payload))
      .filter((u) => u.login.toLowerCase() === needle || String(u.email || '').toLowerCase() === needle);
    if (tenantName) {
      const tenants = await this.listTenants();
      const tenant = tenants.find((t) => t.name.toLowerCase() === tenantName.trim().toLowerCase());
      if (!tenant) return undefined;
      return matches.find((u) => u.tenantId === tenant.tenantId);
    }
    return matches.length === 1 ? matches[0] : matches[0];
  }

  async saveUser(user: PersistedUser): Promise<void> {
    await this.db.query(
      `INSERT INTO users (user_id, tenant_id, login, role_id, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, login = EXCLUDED.login, role_id = EXCLUDED.role_id, payload = EXCLUDED.payload`,
      [user.userId, user.tenantId, user.login, user.roleId, JSON.stringify(user), user.createdAt]
    );
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.query('DELETE FROM users WHERE user_id = $1', [userId]);
  }

  async listUsers(tenantId: string): Promise<PersistedUser[]> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM users WHERE tenant_id = $1 ORDER BY created_at',
      [tenantId]
    );
    return rows.map((r) => parse<PersistedUser>(r.payload));
  }

  async getConfig(tenantId: string): Promise<TenantConfig | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM tenant_configs WHERE tenant_id = $1', [
      tenantId,
    ]);
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async saveConfig(config: TenantConfig): Promise<void> {
    await this.db.query(
      `INSERT INTO tenant_configs (tenant_id, payload, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [config.tenantId, JSON.stringify(config), config.updatedAt]
    );
  }

  async appendTenantAudit(entry: AuditEntry): Promise<void> {
    let entity = 'audit';
    let entityId = entry.target;
    try {
      const parsed = JSON.parse(entry.detail || '{}') as { entityType?: string; entityId?: string };
      if (parsed.entityType) entity = parsed.entityType;
      if (parsed.entityId) entityId = parsed.entityId;
    } catch {
      /* keep defaults */
    }
    await this.db.query(
      `INSERT INTO audit_events (id, tenant_id, actor_id, action, entity, entity_id, ts, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.id,
        entry.tenantId,
        entry.actorId,
        entry.action,
        entity,
        entityId,
        entry.timestamp,
        JSON.stringify(entry),
      ]
    );
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.appendTenantAudit(entry);
  }

  async listAudit(tenantId: string): Promise<AuditEntry[]> {
    return this.listTenantAudit(tenantId);
  }

  async listTenantAudit(tenantId: string): Promise<AuditEntry[]> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM audit_events WHERE tenant_id = $1 ORDER BY ts',
      [tenantId]
    );
    return rows.map((r) => parse<AuditEntry>(r.payload));
  }

  async appendPlatformAudit(entry: PlatformAuditEntry): Promise<void> {
    await this.db.query('INSERT INTO platform_audit (id, payload, ts) VALUES ($1, $2, $3)', [
      entry.id,
      JSON.stringify(entry),
      entry.timestamp,
    ]);
  }

  async listPlatformAudit(): Promise<PlatformAuditEntry[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM platform_audit ORDER BY ts');
    return rows.map((r) => parse<PlatformAuditEntry>(r.payload));
  }

  async create(order: PersistedOrder): Promise<void> {
    const existing = await this.get(order.orderId);
    if (existing) throw new Error(`Order already exists: ${order.orderId}`);
    await this.db.query(
      `INSERT INTO orders (order_id, tenant_id, customer_id, status, created_at, due_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [order.orderId, order.tenantId, order.customerId, order.status, order.createdAt, order.dueAt, JSON.stringify(order)]
    );
    if (order.configurationSnapshot) {
      await this.db.query(
        `INSERT INTO order_snapshots (order_id, tenant_id, snapshot, captured_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (order_id) DO NOTHING`,
        [order.orderId, order.tenantId, JSON.stringify(order.configurationSnapshot), order.configurationSnapshot.capturedAt]
      );
    }
  }

  async get(orderId: string): Promise<PersistedOrder | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM orders WHERE order_id = $1', [orderId]);
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async update(order: PersistedOrder): Promise<void> {
    await this.db.query(
      `UPDATE orders SET tenant_id = $2, customer_id = $3, status = $4, created_at = $5, due_at = $6, payload = $7
       WHERE order_id = $1`,
      [order.orderId, order.tenantId, order.customerId, order.status, order.createdAt, order.dueAt, JSON.stringify(order)]
    );
  }

  async delete(orderId: string): Promise<void> {
    await this.db.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
  }

  async list(tenantId?: string): Promise<PersistedOrder[]> {
    const rows = tenantId
      ? await this.db.query<{ payload: string }>(
          'SELECT payload FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC',
          [tenantId]
        )
      : await this.db.query<{ payload: string }>('SELECT payload FROM orders ORDER BY created_at DESC');
    return rows.map((r) => parse<PersistedOrder>(r.payload));
  }

  async getSnapshot(orderId: string, tenantId: string): Promise<unknown | undefined> {
    const rows = await this.db.query<{ snapshot: string; tenant_id: string }>(
      'SELECT snapshot, tenant_id FROM order_snapshots WHERE order_id = $1',
      [orderId]
    );
    if (!rows[0] || rows[0].tenant_id !== tenantId) return undefined;
    return parse(rows[0].snapshot);
  }

  deadlineStatus(order: PersistedOrder, now = Date.now()) {
    return computeDeadline(order.dueAt, now, DEFAULT_DEADLINE_POLICY);
  }

  async saveProcess(row: ProcessInstance): Promise<void> {
    await this.db.query(
      `INSERT INTO processes (instance_id, tenant_id, order_id, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (instance_id) DO UPDATE SET payload = EXCLUDED.payload, tenant_id = EXCLUDED.tenant_id, order_id = EXCLUDED.order_id`,
      [row.instanceId, row.tenantId, row.orderId, JSON.stringify(row)]
    );
  }

  async saveJob(row: ProductionJob): Promise<void> {
    await this.db.query(
      `INSERT INTO jobs (job_id, tenant_id, order_id, process_instance_id, status, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, tenant_id = EXCLUDED.tenant_id, order_id = EXCLUDED.order_id`,
      [row.jobId, row.tenantId, row.orderId, row.processInstanceId, row.status, JSON.stringify(row)]
    );
  }

  async saveArtifact(row: ProductionArtifact): Promise<void> {
    await this.db.query(
      `INSERT INTO artifacts (artifact_id, tenant_id, order_id, job_id, storage_reference, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (artifact_id) DO UPDATE SET payload = EXCLUDED.payload, storage_reference = EXCLUDED.storage_reference`,
      [row.artifactId, row.tenantId, row.orderId, row.sourceJobId, row.storageReference, JSON.stringify(row)]
    );
  }

  async saveWorker(row: WorkerDescriptor): Promise<void> {
    const tenantId = row.tenantId || '';
    await this.db.query(
      `INSERT INTO workers (worker_id, tenant_id, payload, last_heartbeat)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (worker_id) DO UPDATE SET payload = EXCLUDED.payload, last_heartbeat = EXCLUDED.last_heartbeat, tenant_id = EXCLUDED.tenant_id`,
      [row.workerId, tenantId, JSON.stringify(row), row.lastHeartbeat]
    );
  }

  async listProcesses(orderId: string): Promise<ProcessInstance[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM processes WHERE order_id = $1', [
      orderId,
    ]);
    return rows.map((r) => parse<ProcessInstance>(r.payload)).sort((a, b) => a.order - b.order);
  }

  async listProcessesByTenant(tenantId: string): Promise<ProcessInstance[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM processes WHERE tenant_id = $1', [
      tenantId,
    ]);
    return rows.map((r) => parse<ProcessInstance>(r.payload));
  }

  async getProcess(instanceId: string): Promise<ProcessInstance | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM processes WHERE instance_id = $1', [
      instanceId,
    ]);
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async listJobs(filter: { orderId?: string; processInstanceId?: string; tenantId?: string } = {}): Promise<ProductionJob[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM jobs');
    return rows
      .map((r) => parse<ProductionJob>(r.payload))
      .filter((j) => {
        if (filter.orderId && j.orderId !== filter.orderId) return false;
        if (filter.processInstanceId && j.processInstanceId !== filter.processInstanceId) return false;
        if (filter.tenantId && j.tenantId !== filter.tenantId) return false;
        return true;
      });
  }

  async getJob(jobId: string): Promise<ProductionJob | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM jobs WHERE job_id = $1', [jobId]);
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async listArtifacts(orderId: string): Promise<ProductionArtifact[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM artifacts WHERE order_id = $1', [
      orderId,
    ]);
    return rows.map((r) => parse<ProductionArtifact>(r.payload));
  }

  async listWorkers(): Promise<WorkerDescriptor[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM workers');
    return rows.map((r) => parse<WorkerDescriptor>(r.payload));
  }

  async writeBlob(artifactId: string, bytes: Buffer): Promise<string> {
    const storageReference = `cloud://artifacts/${artifactId}`;
    await this.db.query(
      `INSERT INTO blobs (blob_id, kind, bytes, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (blob_id) DO UPDATE SET bytes = EXCLUDED.bytes`,
      [artifactId, 'artifact', bytes.toString('base64'), Date.now()]
    );
    if (this.blobDir) {
      mkdirSync(this.blobDir, { recursive: true });
      writeFileSync(join(this.blobDir, artifactId), bytes);
    }
    return storageReference;
  }

  async readBlob(fileId: string): Promise<Buffer | undefined> {
    const rows = await this.db.query<{ bytes: string }>('SELECT bytes FROM blobs WHERE blob_id = $1', [fileId]);
    if (!rows[0]?.bytes) return undefined;
    return Buffer.from(rows[0].bytes, 'base64');
  }

  async saveWorkflowDefinition(row: WorkflowDefinition): Promise<void> {
    await this.db.query(
      `INSERT INTO workflows (workflow_id, tenant_id, payload) VALUES ($1, $2, $3)
       ON CONFLICT (workflow_id) DO UPDATE SET payload = EXCLUDED.payload, tenant_id = EXCLUDED.tenant_id`,
      [row.id, row.tenantId, JSON.stringify(row)]
    );
  }

  async listWorkflowDefinitions(tenantId: string): Promise<WorkflowDefinition[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM workflows WHERE tenant_id = $1', [tenantId]);
    return rows.map((r) => parse<WorkflowDefinition>(r.payload));
  }

  async getWorkflowDefinition(workflowId: string): Promise<WorkflowDefinition | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM workflows WHERE workflow_id = $1', [
      workflowId,
    ]);
    return rows[0] ? parse<WorkflowDefinition>(rows[0].payload) : undefined;
  }

  async saveWorkflowInstance(row: WorkflowInstance): Promise<void> {
    await this.db.query(
      `INSERT INTO workflow_instances (instance_id, tenant_id, order_id, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (instance_id) DO UPDATE SET payload = EXCLUDED.payload, tenant_id = EXCLUDED.tenant_id, order_id = EXCLUDED.order_id`,
      [row.instanceId, row.tenantId, row.orderId, JSON.stringify(row)]
    );
  }

  async getWorkflowInstanceByOrder(orderId: string): Promise<WorkflowInstance | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM workflow_instances WHERE order_id = $1', [
      orderId,
    ]);
    return rows[0] ? parse<WorkflowInstance>(rows[0].payload) : undefined;
  }

  async listWorkflowInstances(tenantId: string): Promise<WorkflowInstance[]> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM workflow_instances WHERE tenant_id = $1',
      [tenantId]
    );
    return rows.map((r) => parse<WorkflowInstance>(r.payload));
  }

  async saveCustomer(profile: CustomerProfile): Promise<void> {
    await this.db.query(
      `INSERT INTO customers (customer_id, tenant_id, login, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (customer_id) DO UPDATE SET payload = EXCLUDED.payload, login = EXCLUDED.login, tenant_id = EXCLUDED.tenant_id`,
      [profile.customerId, profile.tenantId, profile.login, JSON.stringify(profile)]
    );
  }

  async getCustomer(customerId: string): Promise<CustomerProfile | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM customers WHERE customer_id = $1', [
      customerId,
    ]);
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async getCustomerByLogin(tenantId: string, login: string): Promise<CustomerProfile | undefined> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM customers WHERE tenant_id = $1 AND login = $2',
      [tenantId, login]
    );
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async listCustomers(tenantId: string): Promise<CustomerProfile[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM customers WHERE tenant_id = $1', [
      tenantId,
    ]);
    return rows.map((r) => parse<CustomerProfile>(r.payload));
  }

  async saveOrderFile(row: OrderFileRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO order_files (id, tenant_id, order_id, customer_id, filename, storage_key, mime_type, size_bytes, status, uploaded_at, payload, converted_key, conversion_status, color_profile_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status, filename = EXCLUDED.filename,
         converted_key = EXCLUDED.converted_key, conversion_status = EXCLUDED.conversion_status, color_profile_key = EXCLUDED.color_profile_key`,
      [
        row.id,
        row.tenantId,
        row.orderId,
        row.customerId,
        row.filename,
        row.storageKey,
        row.mimeType,
        row.sizeBytes,
        row.status,
        row.uploadedAt,
        JSON.stringify(row),
        row.convertedKey || null,
        row.conversionStatus || 'NOT_REQUIRED',
        row.colorProfileKey || null,
      ]
    );
  }

  async getOrderFile(fileId: string): Promise<OrderFileRecord | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM order_files WHERE id = $1', [fileId]);
    return rows[0] ? parse<OrderFileRecord>(rows[0].payload) : undefined;
  }

  async saveAssignment(row: OrderAssignmentRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO order_assignments (id, tenant_id, order_id, assigned_to, assigned_by, assigned_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (order_id) DO UPDATE SET assigned_to = EXCLUDED.assigned_to, assigned_by = EXCLUDED.assigned_by,
         assigned_at = EXCLUDED.assigned_at, payload = EXCLUDED.payload`,
      [row.id, row.tenantId, row.orderId, row.assignedTo, row.assignedBy, row.assignedAt, JSON.stringify(row)]
    );
  }

  async getAssignmentByOrder(orderId: string): Promise<OrderAssignmentRecord | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM order_assignments WHERE order_id = $1', [
      orderId,
    ]);
    return rows[0] ? parse<OrderAssignmentRecord>(rows[0].payload) : undefined;
  }

  async saveInternalComment(row: InternalCommentRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO internal_comments (id, tenant_id, order_id, author_id, content, created_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, row.tenantId, row.orderId, row.authorId, row.content, row.createdAt, JSON.stringify(row)]
    );
  }

  async listInternalComments(tenantId: string, orderId: string): Promise<InternalCommentRecord[]> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM internal_comments WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at',
      [tenantId, orderId]
    );
    return rows.map((r) => parse<InternalCommentRecord>(r.payload));
  }

  async listOrderFiles(tenantId: string, orderId: string): Promise<OrderFileRecord[]> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM order_files WHERE tenant_id = $1 AND order_id = $2',
      [tenantId, orderId]
    );
    return rows.map((r) => parse<OrderFileRecord>(r.payload));
  }

  async savePaymentRecord(row: PaymentRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO payment_records (id, tenant_id, order_id, customer_id, status, payload, gateway, gateway_order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, customer_id = EXCLUDED.customer_id,
         gateway = EXCLUDED.gateway, gateway_order_id = EXCLUDED.gateway_order_id`,
      [
        row.id,
        row.tenantId,
        row.orderId,
        row.customerId,
        row.status,
        JSON.stringify(row),
        row.gateway || null,
        row.gatewayOrderId || null,
      ]
    );
  }

  async getPaymentRecordByOrder(orderId: string): Promise<PaymentRecord | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM payment_records WHERE order_id = $1', [
      orderId,
    ]);
    return rows[0] ? parse<PaymentRecord>(rows[0].payload) : undefined;
  }

  async getPaymentRecordByGatewayOrderId(gatewayOrderId: string): Promise<PaymentRecord | undefined> {
    if (!gatewayOrderId) return undefined;
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM payment_records WHERE gateway_order_id = $1',
      [gatewayOrderId]
    );
    if (rows[0]) return parse<PaymentRecord>(rows[0].payload);
    const all = await this.db.query<{ payload: string }>('SELECT payload FROM payment_records');
    return all.map((r) => parse<PaymentRecord>(r.payload)).find((p) => p.gatewayOrderId === gatewayOrderId);
  }

  async savePaymentAttempt(row: import('../../contracts/payment-gateway').PaymentAttemptRecord): Promise<boolean> {
    try {
      await this.db.query(
        `INSERT INTO payment_attempts (id, tenant_id, order_id, payment_record_id, gateway, gateway_event_id, event_type, status, processed_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          row.id,
          row.tenantId,
          row.orderId,
          row.paymentRecordId,
          row.gateway,
          row.gatewayEventId,
          row.eventType,
          row.status,
          row.processedAt,
          JSON.stringify(row),
        ]
      );
      return true;
    } catch {
      return false;
    }
  }

  async getPaymentAttempt(gateway: string, gatewayEventId: string): Promise<import('../../contracts/payment-gateway').PaymentAttemptRecord | undefined> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM payment_attempts WHERE gateway = $1 AND gateway_event_id = $2',
      [gateway, gatewayEventId]
    );
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async saveFileMeta(record: CustomerFileRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO customer_files (file_id, tenant_id, customer_id, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (file_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [record.fileId, record.tenantId, record.customerId, JSON.stringify(record)]
    );
  }

  async getFile(fileId: string): Promise<CustomerFileRecord | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM customer_files WHERE file_id = $1', [
      fileId,
    ]);
    return rows[0] ? parse(rows[0].payload) : undefined;
  }

  async listFiles(fileIds: string[]): Promise<CustomerFileRecord[]> {
    if (!fileIds.length) return [];
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM customer_files');
    return rows.map((r) => parse<CustomerFileRecord>(r.payload)).filter((f) => fileIds.includes(f.fileId));
  }

  async appendEvent(event: OrderNotificationEvent): Promise<void> {
    await this.db.query(
      'INSERT INTO customer_events (id, order_id, tenant_id, payload) VALUES ($1, $2, $3, $4)',
      [event.id, event.orderId, event.tenantId, JSON.stringify(event)]
    );
  }

  async listEvents(orderId: string): Promise<OrderNotificationEvent[]> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM customer_events WHERE order_id = $1',
      [orderId]
    );
    return rows.map((r) => parse<OrderNotificationEvent>(r.payload));
  }

  async saveSession(
    tokenHash: string,
    ctx: AuthContext,
    expiresAt: number,
    refreshHash: string,
    refreshExpiresAt: number
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO sessions (token_hash, refresh_hash, user_id, tenant_id, role_id, permissions, expires_at, refresh_expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (token_hash) DO UPDATE SET
         refresh_hash = EXCLUDED.refresh_hash,
         expires_at = EXCLUDED.expires_at,
         refresh_expires_at = EXCLUDED.refresh_expires_at,
         user_id = EXCLUDED.user_id,
         tenant_id = EXCLUDED.tenant_id,
         role_id = EXCLUDED.role_id,
         permissions = EXCLUDED.permissions`,
      [
        tokenHash,
        refreshHash,
        ctx.userId,
        ctx.tenantId,
        ctx.roleId,
        JSON.stringify(ctx.permissions),
        expiresAt,
        refreshExpiresAt,
        Date.now(),
      ]
    );
  }

  async getSession(tokenHash: string, now = Date.now()): Promise<PersistedSession | undefined> {
    const rows = await this.db.query<{
      user_id: string;
      tenant_id: string;
      role_id: AuthContext['roleId'];
      permissions: string;
      expires_at: number | string;
      refresh_expires_at: number | string;
      refresh_hash: string;
    }>('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]);
    const row = rows[0];
    if (!row) return undefined;
    if (Number(row.expires_at) < now) return undefined;
    return {
      ctx: {
        token: '',
        userId: row.user_id,
        tenantId: row.tenant_id,
        roleId: row.role_id,
        permissions: parse(row.permissions),
      },
      expiresAt: Number(row.expires_at),
      refreshExpiresAt: Number(row.refresh_expires_at),
      refreshHash: row.refresh_hash,
    };
  }

  async getSessionByRefreshHash(refreshHash: string, now = Date.now()): Promise<PersistedSession | undefined> {
    const rows = await this.db.query<{
      token_hash: string;
      user_id: string;
      tenant_id: string;
      role_id: AuthContext['roleId'];
      permissions: string;
      expires_at: number | string;
      refresh_expires_at: number | string;
      refresh_hash: string;
    }>('SELECT * FROM sessions WHERE refresh_hash = $1', [refreshHash]);
    const row = rows[0];
    if (!row) return undefined;
    if (Number(row.refresh_expires_at) < now) return undefined;
    return {
      ctx: {
        token: '',
        userId: row.user_id,
        tenantId: row.tenant_id,
        roleId: row.role_id,
        permissions: parse(row.permissions),
      },
      expiresAt: Number(row.expires_at),
      refreshExpiresAt: Number(row.refresh_expires_at),
      refreshHash: row.refresh_hash,
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async deleteSessionByRefreshHash(refreshHash: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE refresh_hash = $1', [refreshHash]);
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }

  async invalidateRefreshTokensForTenant(tenantId: string): Promise<void> {
    await this.db.query(
      'UPDATE sessions SET refresh_hash = NULL, refresh_expires_at = 0 WHERE tenant_id = $1',
      [tenantId]
    );
  }

  async createActivationCode(input: {
    id: string;
    code: string;
    expiresAt: number;
    tenantId?: string | null;
    notes?: string | null;
    generatedBy?: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO tenant_activation_codes (id, code, tenant_id, used_at, used_by, expires_at, created_at, notes, generated_by)
       VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7)`,
      [
        input.id,
        input.code,
        input.tenantId || null,
        input.expiresAt,
        Date.now(),
        input.notes || null,
        input.generatedBy || null,
      ]
    );
  }

  async listActivationCodes(): Promise<TenantActivationCodeRow[]> {
    const rows = await this.db.query<ActivationCodeSql>(
      `SELECT id, code, tenant_id, used_at, used_by, expires_at, notes, generated_by, invalidated_at
       FROM tenant_activation_codes ORDER BY created_at DESC`
    );
    return rows.map(mapActivationCode);
  }

  async getActivationCodeById(id: string): Promise<TenantActivationCodeRow | undefined> {
    const rows = await this.db.query<ActivationCodeSql>(
      `SELECT id, code, tenant_id, used_at, used_by, expires_at, notes, generated_by, invalidated_at
       FROM tenant_activation_codes WHERE id = $1`,
      [id]
    );
    return rows[0] ? mapActivationCode(rows[0]) : undefined;
  }

  async invalidateActivationCode(id: string, at = Date.now()): Promise<void> {
    await this.db.query(
      'UPDATE tenant_activation_codes SET invalidated_at = $2, expires_at = $2 WHERE id = $1 AND used_at IS NULL',
      [id, at]
    );
  }

  async getActivationCode(code: string): Promise<TenantActivationCodeRow | undefined> {
    const rows = await this.db.query<ActivationCodeSql>(
      `SELECT id, code, tenant_id, used_at, used_by, expires_at, notes, generated_by, invalidated_at
       FROM tenant_activation_codes WHERE code = $1`,
      [code]
    );
    return rows[0] ? mapActivationCode(rows[0]) : undefined;
  }

  async consumeActivationCode(code: string, tenantId: string, usedBy: string, usedAt = Date.now()): Promise<void> {
    await this.db.query(
      'UPDATE tenant_activation_codes SET tenant_id = $2, used_at = $3, used_by = $4 WHERE code = $1',
      [code, tenantId, usedAt, usedBy]
    );
  }

  async findUserByVerificationToken(token: string): Promise<PersistedUser | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM users');
    return rows.map((r) => parse<PersistedUser>(r.payload)).find((u) => u.verificationToken === token);
  }

  async getIdempotency(tenantId: string, key: string) {
    const rows = await this.db.query<{ status: number; body: string }>(
      'SELECT status, body FROM idempotency_keys WHERE tenant_id = $1 AND key = $2',
      [tenantId, key]
    );
    return rows[0];
  }

  async saveIdempotency(tenantId: string, key: string, method: string, path: string, status: number, body: unknown) {
    await this.db.query(
      `INSERT INTO idempotency_keys (tenant_id, key, method, path, status, body, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, key, method, path, status, JSON.stringify(body), Date.now()]
    );
  }

  async bindWorkerToken(workerId: string, tenantId: string, tokenHash: string): Promise<void> {
    await this.db.query('UPDATE workers SET token_hash = $2, tenant_id = $3 WHERE worker_id = $1', [
      workerId,
      tokenHash,
      tenantId,
    ]);
  }

  async getWorkerByTokenHash(tokenHash: string): Promise<{ worker: WorkerDescriptor; tenantId: string } | undefined> {
    const rows = await this.db.query<{ payload: string; tenant_id: string }>(
      'SELECT payload, tenant_id FROM workers WHERE token_hash = $1',
      [tokenHash]
    );
    if (!rows[0]) return undefined;
    return { worker: parse(rows[0].payload), tenantId: rows[0].tenant_id };
  }

  async saveNotification(row: OperationalNotification): Promise<'created' | 'exists'> {
    try {
      await this.db.query(
        `INSERT INTO notifications (notification_id, tenant_id, recipient_id, type, entity_id, audience, read, dedupe_key, created_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          row.notificationId,
          row.tenantId,
          row.recipientId,
          row.type,
          row.entityId,
          row.audience,
          row.read ? 1 : 0,
          row.dedupeKey,
          row.createdAt,
          JSON.stringify(row),
        ]
      );
      return 'created';
    } catch {
      return 'exists';
    }
  }

  async listNotifications(filter: {
    tenantId: string;
    recipientId?: string;
    audience?: OperationalNotification['audience'];
  }): Promise<OperationalNotification[]> {
    const rows = await this.db.query<{ payload: string }>(
      filter.audience === 'platform'
        ? 'SELECT payload FROM notifications WHERE audience = $1 AND recipient_id = $2 ORDER BY created_at DESC'
        : filter.recipientId
          ? 'SELECT payload FROM notifications WHERE tenant_id = $1 AND recipient_id = $2 ORDER BY created_at DESC'
          : 'SELECT payload FROM notifications WHERE tenant_id = $1 ORDER BY created_at DESC',
      filter.audience === 'platform'
        ? [filter.audience, filter.recipientId || '']
        : filter.recipientId
          ? [filter.tenantId, filter.recipientId]
          : [filter.tenantId]
    );
    return rows.map((r) => parse<OperationalNotification>(r.payload));
  }

  async getNotification(notificationId: string): Promise<OperationalNotification | undefined> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM notifications WHERE notification_id = $1',
      [notificationId]
    );
    return rows[0] ? parse<OperationalNotification>(rows[0].payload) : undefined;
  }

  async markNotificationRead(notificationId: string, readAt: number): Promise<OperationalNotification | undefined> {
    const current = await this.getNotification(notificationId);
    if (!current) return undefined;
    const next = { ...current, read: true, readAt };
    await this.db.query('UPDATE notifications SET read = 1, payload = $2 WHERE notification_id = $1', [
      notificationId,
      JSON.stringify(next),
    ]);
    return next;
  }

  async recordAudit(entry: {
    id: string;
    tenantId: string;
    actorId?: string;
    action: string;
    entity?: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    await this.appendTenantAudit({
      id: entry.id,
      timestamp: Date.now(),
      tenantId: entry.tenantId,
      actorId: entry.actorId || '',
      action: entry.action,
      target: entry.entityId || entry.entity || '',
      result: 'ok',
      detail: JSON.stringify({ before: entry.before, after: entry.after, entity: entry.entity }),
    });
  }

  async saveEmailLog(row: EmailLogRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO email_logs (id, tenant_id, order_id, status, event_type, recipient_email, created_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, order_id = EXCLUDED.order_id`,
      [
        row.id,
        row.tenantId,
        row.orderId || null,
        row.status,
        row.eventType,
        row.recipientEmail,
        row.createdAt,
        JSON.stringify(row),
      ]
    );
  }

  async getEmailLog(id: string): Promise<EmailLogRecord | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM email_logs WHERE id = $1', [id]);
    return rows[0] ? parse<EmailLogRecord>(rows[0].payload) : undefined;
  }

  async listEmailLogs(tenantId: string, orderId?: string): Promise<EmailLogRecord[]> {
    const rows = orderId
      ? await this.db.query<{ payload: string }>(
          'SELECT payload FROM email_logs WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at',
          [tenantId, orderId]
        )
      : await this.db.query<{ payload: string }>(
          'SELECT payload FROM email_logs WHERE tenant_id = $1 ORDER BY created_at',
          [tenantId]
        );
    return rows.map((r) => parse<EmailLogRecord>(r.payload));
  }

  async listEmailLogsByStatus(status: string): Promise<EmailLogRecord[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM email_logs WHERE status = $1', [status]);
    return rows.map((r) => parse<EmailLogRecord>(r.payload));
  }

  async saveClientMessage(row: ClientMessage): Promise<void> {
    const { entries, ...head } = row;
    await this.db.query(
      `INSERT INTO client_messages (id, tenant_id, customer_id, category, status, subject, order_id, created_at, updated_at, resolved_at, resolved_by, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, status = EXCLUDED.status, subject = EXCLUDED.subject,
         order_id = EXCLUDED.order_id, updated_at = EXCLUDED.updated_at, resolved_at = EXCLUDED.resolved_at, resolved_by = EXCLUDED.resolved_by, payload = EXCLUDED.payload`,
      [
        row.id,
        row.tenantId,
        row.customerId,
        row.category,
        row.status,
        row.subject,
        row.orderId || null,
        row.createdAt,
        row.updatedAt,
        row.resolvedAt || null,
        row.resolvedBy || null,
        JSON.stringify(head),
      ]
    );
    for (const entry of entries || []) await this.saveMessageEntry(entry);
  }

  async saveMessageEntry(entry: MessageEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO message_entries (id, message_id, author_id, author_role, content, created_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, payload = EXCLUDED.payload`,
      [entry.id, entry.messageId, entry.authorId, entry.authorRole, entry.content, entry.createdAt, JSON.stringify(entry)]
    );
  }

  async getClientMessage(id: string): Promise<ClientMessage | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM client_messages WHERE id = $1', [id]);
    if (!rows[0]) return undefined;
    const head = parse<Omit<ClientMessage, 'entries'>>(rows[0].payload);
    const entries = await this.listMessageEntries(id);
    return { ...head, entries };
  }

  async listMessageEntries(messageId: string): Promise<MessageEntry[]> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM message_entries WHERE message_id = $1 ORDER BY created_at',
      [messageId]
    );
    return rows.map((r) => parse<MessageEntry>(r.payload));
  }

  async listClientMessages(
    tenantId: string,
    filter?: { customerId?: string; status?: string; category?: string; q?: string; evaluationStatus?: string }
  ): Promise<ClientMessage[]> {
    const rows = await this.db.query<{ payload: string; id: string }>(
      'SELECT id, payload FROM client_messages WHERE tenant_id = $1 ORDER BY updated_at DESC',
      [tenantId]
    );
    const out: ClientMessage[] = [];
    for (const r of rows) {
      const head = parse<Omit<ClientMessage, 'entries'>>(r.payload);
      if (filter?.customerId && head.customerId !== filter.customerId) continue;
      if (filter?.status && head.status !== filter.status) continue;
      if (filter?.category && head.category !== filter.category) continue;
      if (filter?.evaluationStatus && head.evaluation?.status !== filter.evaluationStatus) continue;
      if (filter?.q) {
        const needle = filter.q.trim().toLowerCase();
        const hay = `${head.subject} ${head.customerId} ${head.category}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      out.push({ ...head, entries: await this.listMessageEntries(head.id) });
    }
    return out;
  }

  async saveMembership(row: Membership): Promise<void> {
    await this.db.query(
      `INSERT INTO memberships (id, tenant_id, customer_id, plan_id, status, started_at, expires_at, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (customer_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, started_at = EXCLUDED.started_at,
         expires_at = EXCLUDED.expires_at, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [
        row.id,
        row.tenantId,
        row.customerId,
        row.planId,
        row.status,
        row.startedAt,
        row.expiresAt,
        JSON.stringify(row),
        row.createdAt,
        row.updatedAt,
      ]
    );
  }

  async getMembershipByCustomer(customerId: string): Promise<Membership | undefined> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM memberships WHERE customer_id = $1',
      [customerId]
    );
    return rows[0] ? parse<Membership>(rows[0].payload) : undefined;
  }

  async listMemberships(tenantId: string): Promise<Membership[]> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM memberships WHERE tenant_id = $1',
      [tenantId]
    );
    return rows.map((r) => parse<Membership>(r.payload));
  }

  async saveWorkshopItem(item: WorkshopCatalogItem): Promise<void> {
    await this.db.query(
      `INSERT INTO workshop_catalog_items (item_id, tenant_id, category, stock_enabled, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (item_id) DO UPDATE SET
         category = EXCLUDED.category, stock_enabled = EXCLUDED.stock_enabled,
         payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [item.itemId, item.tenantId, item.category, item.stockEnabled ? 1 : 0, JSON.stringify(item), item.updatedAt]
    );
  }

  async getWorkshopItem(itemId: string): Promise<WorkshopCatalogItem | undefined> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM workshop_catalog_items WHERE item_id = $1',
      [itemId]
    );
    return rows[0] ? parse<WorkshopCatalogItem>(rows[0].payload) : undefined;
  }

  async listWorkshopItems(tenantId: string): Promise<WorkshopCatalogItem[]> {
    const rows = await this.db.query<{ payload: string }>(
      'SELECT payload FROM workshop_catalog_items WHERE tenant_id = $1',
      [tenantId]
    );
    return rows.map((r) => parse<WorkshopCatalogItem>(r.payload));
  }

  async saveSecurityBlock(row: SecurityBlockRow): Promise<void> {
    await this.db.query(
      `INSERT INTO security_blocks (id, subject_type, subject_id, until_ts, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET until_ts = EXCLUDED.until_ts, payload = EXCLUDED.payload`,
      [row.id, row.subjectType, row.subjectId, row.until, JSON.stringify(row)]
    );
  }

  async listSecurityBlocks(): Promise<SecurityBlockRow[]> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM security_blocks');
    return rows.map((r) => parse<SecurityBlockRow>(r.payload));
  }

  async deleteSecurityBlock(id: string): Promise<void> {
    await this.db.query('DELETE FROM security_blocks WHERE id = $1', [id]);
  }

  async getSecurityPolicy(): Promise<SecurityPolicy | undefined> {
    const rows = await this.db.query<{ payload: string }>(
      "SELECT payload FROM platform_security_config WHERE id = 'default'"
    );
    return rows[0] ? parse<SecurityPolicy>(rows[0].payload) : undefined;
  }

  async saveSecurityPolicy(policy: SecurityPolicy): Promise<void> {
    await this.db.query(
      `INSERT INTO platform_security_config (id, payload, updated_at) VALUES ('default', $1, $2)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(policy), Date.now()]
    );
  }

  async saveCapabilityJob(row: import('../../contracts/ora-core').OraCapabilityJob): Promise<void> {
    await this.db.query(
      `INSERT INTO capability_jobs (job_id, tenant_id, capability, status, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload`,
      [row.jobId, row.tenantId, row.capability, row.status, JSON.stringify(row), row.createdAt]
    );
  }

  async getCapabilityJob(jobId: string): Promise<import('../../contracts/ora-core').OraCapabilityJob | undefined> {
    const rows = await this.db.query<{ payload: string }>('SELECT payload FROM capability_jobs WHERE job_id = $1', [jobId]);
    return rows[0] ? parse(rows[0].payload) : undefined;
  }
}
