import { randomUUID } from 'crypto';
import type { AuthContext, AuditEntry, PersistedUser } from '../../contracts/admin-domain';
import { AccessDeniedError, CUSTOMER_DEFAULT_PERMISSIONS } from '../../contracts/admin-domain';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import type {
  CustomerOrderView,
  CustomerProfile,
  OrderNotificationEvent,
  OrderNotificationType,
  OrderPreviewSummary,
} from '../../contracts/customer-experience';
import {
  assertNoInternalLeak,
  CUSTOMER_STATUS_LABELS,
  toCustomerOrderView,
} from '../../contracts/customer-experience';
import { resolveConfiguredCurrency } from '../../contracts/international-domain';
import type { OrderAttachmentRef, OrderStatus, PersistedOrder } from '../../contracts/order-domain';
import { hashPassword } from './passwordHash';
import type { AdminRepository } from './AdminRepository';
import type { AdminService } from './AdminService';
import type { CustomerStore } from './CustomerStore';
import type { OrderService } from './OrderService';
import type { ProductionOrchestrator } from './ProductionOrchestrator';
import type { WorkflowEngine } from './WorkflowEngine';
import type { TraceService } from './TraceService';
import { actorTypeFromRole } from '../../contracts/trace-domain';

const FORBIDDEN_VALUE_KEYS = new Set([
  'tenantId',
  'customerId',
  'internalUnitCost',
  'totalInternalCost',
  'internalCost',
  'status',
  'schema',
  'schemaVersion',
  'deadline',
  'dueAt',
  'permissions',
  'jobId',
  'jobs',
  'jobIds',
]);

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_SLA_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES: OrderStatus[] = [
  'pending',
  'received',
  'reviewing',
  'editing',
  'approved',
  'preparing',
  'printing',
  'printing_in_progress',
  'production',
  'ready',
];
const FINISHED_STATUSES: OrderStatus[] = ['completed', 'delivered'];
const CANCELLED_STATUSES: OrderStatus[] = ['cancelled'];

export type CustomerListFilter = 'all' | 'active' | 'finished' | 'expired' | 'cancelled';

export class CustomerPortalService {
  private orchestrator?: ProductionOrchestrator;
  private workflows?: WorkflowEngine;
  private tracer?: TraceService;

  constructor(
    private admin: AdminService,
    private adminRepo: AdminRepository,
    private orders: OrderService,
    private store: CustomerStore
  ) {
    this.orders.setLifecycleHook((payload) => this.onLifecycle(payload.type, payload.order));
  }

  setOrchestrator(orchestrator: ProductionOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  setWorkflows(workflows: WorkflowEngine): void {
    this.workflows = workflows;
  }

  setTracer(tracer: TraceService): void {
    this.tracer = tracer;
  }

  async register(input: {
    tenantId: string;
    name: string;
    contact: string;
    login: string;
    password: string;
    metadata?: Record<string, string>;
    phone?: string;
    preferredLanguage?: string;
    country?: string;
    region?: string;
    city?: string;
    postalCode?: string;
    address?: string;
  }): Promise<CustomerProfile> {
    const tenant = await this.adminRepo.getTenant();
    const config = await this.adminRepo.getConfig(input.tenantId);
    if (!config || config.tenantId !== input.tenantId) throw new AccessDeniedError();
    if (tenant && tenant.tenantId === input.tenantId && tenant.activated === false) throw new AccessDeniedError();
    if (!input.name?.trim() || !input.contact?.trim() || !input.login?.trim()) {
      throw new RequestInvalidError('CUSTOMER_IDENTITY');
    }
    const existing = await this.adminRepo.getUserByLogin(input.tenantId, input.login.trim());
    if (existing) throw new RequestInvalidError('LOGIN_TAKEN');
    const now = Date.now();
    const customerId = randomUUID();
    const user: PersistedUser = {
      userId: customerId,
      tenantId: input.tenantId,
      login: input.login.trim(),
      displayCode: `CLI-${customerId.slice(0, 8)}`,
      roleId: 'CUSTOMER',
      permissions: [...CUSTOMER_DEFAULT_PERMISSIONS],
      status: 'active',
      password: await hashPassword(input.password),
      createdAt: now,
      updatedAt: now,
    };
    await this.adminRepo.saveUser(user);
    const profile: CustomerProfile = {
      customerId,
      tenantId: input.tenantId,
      name: input.name.trim(),
      contact: input.contact.trim(),
      login: user.login,
      email: input.contact.includes('@') ? input.contact.trim() : undefined,
      phone: input.phone,
      preferredLanguage: input.preferredLanguage,
      country: input.country,
      region: input.region,
      city: input.city,
      postalCode: input.postalCode,
      address: input.address,
      status: 'active',
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveCustomer(profile);
    return profile;
  }

  async login(login: string, password: string) {
    const result = await this.admin.login(login, password);
    if (result.session.roleId !== 'CUSTOMER') throw new AccessDeniedError();
    const profile = await this.requireProfile(result.session.userId);
    if (profile.tenantId !== result.session.tenantId) throw new AccessDeniedError();
    await this.audit(result.session.tenantId, result.session.userId, 'customer.login', result.session.userId, 'ok');
    return { ...result, profile };
  }

  async getForm(ctx: AuthContext, disciplineId: string, productId?: string) {
    this.assertCustomer(ctx);
    if (productId) return this.admin.configuration.getFormForProduct(ctx.tenantId, productId, 'customer');
    return this.admin.configuration.getFormSchema(ctx.tenantId, disciplineId, 'customer');
  }

  async listRubrics(ctx: AuthContext) {
    this.assertCustomer(ctx);
    return this.admin.configuration.listEnabledDisciplines(ctx.tenantId);
  }

  async listProducts(ctx: AuthContext, rubricId?: string) {
    this.assertCustomer(ctx);
    return this.admin.configuration.listActiveProducts(ctx.tenantId, rubricId);
  }

  async meta(ctx: AuthContext) {
    this.assertCustomer(ctx);
    const profile = await this.requireProfile(ctx.userId);
    const tenant = await this.adminRepo.getTenant();
    const config = await this.adminRepo.getConfig(ctx.tenantId);
    return {
      workshopName:
        config?.identity?.commercialName ||
        (tenant && tenant.tenantId === ctx.tenantId ? tenant.name : undefined) ||
        'Taller',
      currency: resolveConfiguredCurrency({
        currency: config?.identity?.currency || tenant?.currency,
      }),
      tenantId: ctx.tenantId,
      customerId: profile.customerId,
      customerName: profile.name,
    };
  }

  async saveDraft(
    ctx: AuthContext,
    input: { rubricId: string; productId?: string; values?: Record<string, unknown>; instanceId?: string }
  ) {
    this.assertCustomer(ctx);
    const values = sanitizeValues(input.values || {});
    if (input.instanceId) {
      const existing = await this.admin.configuration.getDraft(ctx.tenantId, input.instanceId, ctx.userId);
      const saved = await this.admin.configuration.saveFormResponse(ctx.tenantId, existing.instanceId, values, 'customer');
      await this.audit(ctx.tenantId, ctx.userId, 'draft.updated', saved.instanceId, 'ok');
      return saved;
    }
    const created = await this.admin.configuration.createFormInstance(ctx.tenantId, {
      rubricId: input.rubricId,
      productId: input.productId,
      customerId: ctx.userId,
      values,
    });
    await this.audit(ctx.tenantId, ctx.userId, 'draft.created', created.instanceId, 'ok');
    return created;
  }

  async listDrafts(ctx: AuthContext) {
    this.assertCustomer(ctx);
    return this.admin.configuration.listDrafts(ctx.tenantId, ctx.userId);
  }

  async getDraft(ctx: AuthContext, instanceId: string) {
    this.assertCustomer(ctx);
    return this.admin.configuration.getDraft(ctx.tenantId, instanceId, ctx.userId);
  }

  async preview(
    ctx: AuthContext,
    input: { disciplineId: string; values: Record<string, unknown> }
  ): Promise<OrderPreviewSummary> {
    this.assertCustomer(ctx);
    const values = sanitizeValues(input.values);
    await this.admin.configuration.validateSubmission(ctx.tenantId, input.disciplineId, values, 'customer');
    const form = await this.admin.configuration.getFormSchema(ctx.tenantId, input.disciplineId, 'customer');
    const dueAt = Date.now() + DEFAULT_SLA_MS;
    const quantityField = form.fields.find((f) => f.type === 'quantity');
    const materialField = form.fields.find((f) => f.type === 'material');
    const productField = form.fields.find((f) => f.fieldId === 'product' || f.name === 'product');
    const quantity = quantityField ? Number(values[quantityField.fieldId] ?? values[quantityField.name]) : undefined;
    const materialId = materialField
      ? String(values[materialField.fieldId] ?? values[materialField.name] ?? '')
      : '';
    const material = form.materials.find((m) => m.materialId === materialId);
    let amount: number | undefined;
    let consumption: string | undefined;
    if (material && Number.isFinite(quantity)) {
      const quote = await this.admin.configuration.quoteLine(
        ctx.tenantId,
        input.disciplineId,
        material.materialId,
        Number(quantity),
        false
      );
      amount = quote.customerAmount;
      consumption = `${quote.quantity} ${quote.unit}`;
    }
    return {
      disciplineId: input.disciplineId,
      schemaVersion: form.schemaVersion,
      product: productField ? String(values[productField.fieldId] ?? values[productField.name] ?? '') : undefined,
      quantity,
      materialName: material?.name,
      unit: material?.unit,
      consumption,
      amount,
      dueAt,
      fields: form.fields.map((f) => ({
        label: f.label,
        value: String(values[f.fieldId] ?? values[f.name] ?? ''),
      })),
    };
  }

  async stageFile(
    ctx: AuthContext,
    input: { filename: string; mimeType: string; contentBase64: string }
  ): Promise<OrderAttachmentRef> {
    this.assertCustomer(ctx);
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (!bytes.length) throw new RequestInvalidError('EMPTY_FILE');
    if (bytes.length > MAX_FILE_BYTES) throw new RequestInvalidError('FILE_TOO_LARGE');
    if (!isAllowedFile(input.filename, input.mimeType)) throw new RequestInvalidError('FILE_TYPE');
    const fileId = randomUUID();
    const storageReference = await this.store.writeBlob(fileId, bytes);
    const record: OrderAttachmentRef = {
      fileId,
      storageReference,
      filename: input.filename.replace(/\\/g, '/').split('/').pop() || 'file',
      mimeType: input.mimeType || 'application/octet-stream',
      size: bytes.length,
      createdAt: Date.now(),
      version: 1,
      current: true,
    };
    await this.store.saveFileMeta({
      ...record,
      tenantId: ctx.tenantId,
      customerId: ctx.userId,
      staged: true,
    });
    await this.audit(ctx.tenantId, ctx.userId, 'file.uploaded', fileId, 'ok', record.filename);
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'artifact',
        entityId: fileId,
        eventType: 'ARTIFACT_UPLOADED',
        actorType: 'CUSTOMER',
        actorId: ctx.userId,
        metadata: { filename: record.filename, size: record.size },
        correlationId: fileId,
      });
    }
    return record;
  }

  async submit(
    ctx: AuthContext,
    input: {
      disciplineId: string;
      values: Record<string, unknown>;
      fileIds?: string[];
      summary?: string;
      tenantId?: string;
      customerId?: string;
      dueAt?: number;
      status?: string;
      productId?: string;
      instanceId?: string;
    }
  ): Promise<CustomerOrderView> {
    this.assertCustomer(ctx);
    const profile = await this.requireProfile(ctx.userId);
    const values = sanitizeValues(input.values);
    const files = await this.store.listFiles(input.fileIds || []);
    for (const file of files) {
      if (file.tenantId !== ctx.tenantId || file.customerId !== ctx.userId) throw new AccessDeniedError();
    }
    const dueAt = Date.now() + DEFAULT_SLA_MS;
    const productId = input.productId || String(values.productId || '');
    const order = await this.admin.configuration.submitOrder(ctx, {
      disciplineId: input.disciplineId,
      values,
      customerId: ctx.userId,
      customerName: profile.name,
      dueAt,
      summary: input.summary || String(values.product || values.productName || 'Pedido'),
      initialStatus: 'received',
      productId: productId || undefined,
      instanceId: input.instanceId,
      attachments: files.map((f) => ({
        fileId: f.fileId,
        storageReference: f.storageReference,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
        createdAt: f.createdAt,
        version: f.version,
        current: f.current,
        replacesFileId: f.replacesFileId,
      })),
    });
    for (const file of files) {
      await this.store.saveFileMeta({ ...file, orderId: order.orderId, staged: false });
    }
    try {
      await this.orchestrator?.startProductionForSubmit(order.orderId, ctx.tenantId);
    } catch {
      /* order remains valid if pipeline bootstrap is deferred */
    }
    await this.audit(ctx.tenantId, ctx.userId, 'order.created', order.orderId, 'ok', order.displayNumber);
    await this.audit(ctx.tenantId, ctx.userId, 'order.submitted', order.orderId, 'ok', order.displayNumber);
    const view = await this.viewOf((await this.orders.getOrder(order.orderId, 'admin')) || order, ctx);
    view.confirmationMessage = 'Pedido recibido';
    return view;
  }

  async list(ctx: AuthContext, filter: CustomerListFilter = 'all', query?: string): Promise<CustomerOrderView[]> {
    this.assertCustomer(ctx);
    const listed = await this.orders.listOrders(ctx.tenantId, 'customer', Date.now(), ctx.userId);
    const views: CustomerOrderView[] = [];
    for (const order of listed) {
      await this.maybeNearDeadline(order);
      views.push(await this.viewOf(order, ctx));
    }
    const needle = (query || '').trim().toLowerCase();
    return views.filter((view) => matchesFilter(view, filter)).filter((view) => {
      if (!needle) return true;
      return [view.number, view.summary, view.product, view.statusLabel, view.statusMessage]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(needle));
    });
  }

  async get(ctx: AuthContext, orderId: string): Promise<CustomerOrderView> {
    this.assertCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    await this.maybeNearDeadline(order);
    return this.viewOf(order, ctx);
  }

  async approve(
    ctx: AuthContext,
    orderId: string,
    input: { decision: 'approved' | 'rejected'; schemaVersion?: number; note?: string }
  ): Promise<CustomerOrderView> {
    this.assertCustomer(ctx);
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    const currentFile = (order.attachments || []).find((f) => f.current);
    const updated = await this.orders.recordApproval(
      order.orderId,
      {
        actorId: ctx.userId,
        at: Date.now(),
        schemaVersion: input.schemaVersion ?? order.configurationSnapshot?.schemaVersion,
        fileVersion: currentFile?.version,
        decision: input.decision,
        note: input.note,
      },
      input.decision === 'approved' ? 'approved' : 'rejected'
    );
    await this.orchestrator?.onCustomerApproval(order.orderId, ctx.tenantId, input.decision);
    await this.audit(
      ctx.tenantId,
      ctx.userId,
      input.decision === 'approved' ? 'order.approval' : 'order.change_request',
      order.orderId,
      'ok',
      input.note
    );
    if (this.tracer) {
      const version = currentFile?.version;
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'approval',
        entityId: order.orderId,
        eventType: input.decision === 'approved' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
        actorType: 'CUSTOMER',
        actorId: ctx.userId,
        metadata: { orderId: order.orderId, artifactVersion: version, comment: input.note, status: updated.approvalStatus },
        correlationId: order.orderId,
      });
      if (input.decision === 'approved') {
        await this.tracer.record({
          tenantId: ctx.tenantId,
          entityType: 'artifact',
          entityId: currentFile?.fileId || order.orderId,
          eventType: 'ARTIFACT_APPROVED',
          actorType: 'CUSTOMER',
          actorId: ctx.userId,
          metadata: { orderId: order.orderId, artifactVersion: version },
          correlationId: order.orderId,
        });
        await this.tracer.notifyOperational({
          tenantId: ctx.tenantId,
          type: 'ORDER_STATUS_CHANGED',
          title: 'Pedido aprobado',
          workshopMessage: `El cliente aprobó el pedido ${updated.displayNumber || order.orderId}.`,
          entityType: 'order',
          entityId: order.orderId,
          order: updated,
          dedupeKey: `${order.orderId}:APPROVED:${version || 0}`,
          includeWorkshop: true,
        });
      }
    }
    return this.viewOf((await this.orders.getOrder(order.orderId, 'admin')) || updated, ctx);
  }

  async requestChanges(ctx: AuthContext, orderId: string, note: string): Promise<CustomerOrderView> {
    this.assertCustomer(ctx);
    if (!note?.trim()) throw new RequestInvalidError('CHANGE_NOTE_REQUIRED');
    const order = await this.orders.getOrderForCustomer(orderId, ctx.tenantId, ctx.userId);
    const originalAttachments = JSON.stringify(order.attachments || []);
    const currentFile = (order.attachments || []).find((f) => f.current);
    const updated = await this.orders.recordApproval(
      order.orderId,
      {
        actorId: ctx.userId,
        at: Date.now(),
        schemaVersion: order.configurationSnapshot?.schemaVersion,
        fileVersion: currentFile?.version,
        decision: 'rejected',
        note: note.trim(),
      },
      'rejected'
    );
    await this.orders.appendHistoryNote(
      orderId,
      { actorId: ctx.userId, role: 'customer' },
      note.trim()
    );
    const preserved = await this.orders.getOrder(order.orderId, 'admin');
    if (JSON.stringify(preserved?.attachments || []) !== originalAttachments) {
      throw new Error('VERSION_MUTATED');
    }
    await this.orchestrator?.onCustomerApproval(order.orderId, ctx.tenantId, 'rejected');
    await this.emit('ORDER_REVISION_REQUESTED', preserved || updated, note.trim());
    await this.audit(ctx.tenantId, ctx.userId, 'order.change_request', order.orderId, 'ok');
    if (this.tracer) {
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'approval',
        entityId: order.orderId,
        eventType: 'CHANGE_REQUESTED',
        actorType: 'CUSTOMER',
        actorId: ctx.userId,
        metadata: { orderId: order.orderId, artifactVersion: currentFile?.version, comment: note.trim() },
        correlationId: order.orderId,
      });
      await this.tracer.record({
        tenantId: ctx.tenantId,
        entityType: 'order',
        entityId: order.orderId,
        eventType: 'ORDER_CHANGE_REQUESTED',
        actorType: 'CUSTOMER',
        actorId: ctx.userId,
        metadata: { orderId: order.orderId, comment: note.trim(), artifactVersion: currentFile?.version },
        correlationId: order.orderId,
      });
      await this.tracer.notifyOperational({
        tenantId: ctx.tenantId,
        type: 'CHANGE_REQUESTED',
        title: 'Cambio solicitado',
        customerMessage: 'Recibimos tu solicitud de cambios.',
        workshopMessage: `El cliente solicitó cambios en el pedido. ${note.trim()}`,
        entityType: 'order',
        entityId: order.orderId,
        order: preserved || updated,
        dedupeKey: `${order.orderId}:CHANGE_REQUESTED:${Date.now()}`,
        includeCustomer: true,
        includeWorkshop: true,
        includeOperators: true,
        comment: note.trim(),
      });
    }
    return this.viewOf((await this.orders.getOrder(order.orderId, 'admin')) || updated, ctx);
  }

  async downloadFile(ctx: AuthContext, fileId: string) {
    this.assertCustomer(ctx);
    const file = await this.store.getFile(fileId);
    if (!file || file.tenantId !== ctx.tenantId || file.customerId !== ctx.userId) throw new AccessDeniedError();
    const bytes = this.store.readBlob ? await this.store.readBlob(fileId) : undefined;
    if (!bytes) throw new AccessDeniedError();
    await this.audit(ctx.tenantId, ctx.userId, 'file.downloaded', fileId, 'ok', file.filename);
    return {
      fileId: file.fileId,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      contentBase64: bytes.toString('base64'),
    };
  }

  async requestRevision(adminCtx: AuthContext, orderId: string): Promise<PersistedOrder> {
    this.assertWorkshop(adminCtx);
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== adminCtx.tenantId) throw new AccessDeniedError();
    const original = JSON.stringify(order.formValues || {});
    const updated = await this.orders.appendHistoryNote(
      orderId,
      { actorId: adminCtx.userId, role: 'admin' },
      'El taller solicitó modificar información del pedido.'
    );
    if (JSON.stringify(updated.formValues || {}) !== original) {
      throw new Error('ORIGINAL_VALUES_MUTATED');
    }
    await this.emit('ORDER_REVISION_REQUESTED', updated, 'El taller solicitó modificar información del pedido.');
    return updated;
  }

  async addFileVersion(
    adminCtx: AuthContext,
    orderId: string,
    sourceFileId: string,
    input: { filename: string; mimeType: string; contentBase64: string }
  ): Promise<PersistedOrder> {
    this.assertWorkshop(adminCtx);
    const order = await this.orders.getOrder(orderId, 'admin');
    if (!order || order.tenantId !== adminCtx.tenantId) throw new AccessDeniedError();
    const existing = (order.attachments || []).find((f) => f.fileId === sourceFileId);
    if (!existing) throw new RequestInvalidError('FILE_NOT_FOUND');
    const bytes = Buffer.from(input.contentBase64, 'base64');
    const fileId = randomUUID();
    const storageReference = await this.store.writeBlob(fileId, bytes);
    const nextVersion = Math.max(...(order.attachments || []).map((f) => f.version), existing.version) + 1;
    const next: OrderAttachmentRef = {
      fileId,
      storageReference,
      filename: input.filename,
      mimeType: input.mimeType,
      size: bytes.length,
      createdAt: Date.now(),
      version: nextVersion,
      current: true,
      replacesFileId: sourceFileId,
    };
    const attachments = (order.attachments || []).map((f) =>
      f.fileId === sourceFileId || f.current ? { ...f, current: false } : f
    );
    attachments.push(next);
    await this.store.saveFileMeta({
      ...next,
      tenantId: order.tenantId,
      customerId: order.customerId,
      orderId: order.orderId,
      staged: false,
    });
    const replaced = await this.orders.replaceAttachments(orderId, attachments);
    if (this.tracer) {
      await this.tracer.record({
        tenantId: order.tenantId,
        entityType: 'artifact',
        entityId: fileId,
        eventType: 'ARTIFACT_VERSION_CREATED',
        actorType: actorTypeFromRole(adminCtx.roleId, adminCtx.userId),
        actorId: adminCtx.userId,
        metadata: { orderId, artifactVersion: nextVersion, filename: next.filename },
        correlationId: orderId,
      });
      await this.tracer.record({
        tenantId: order.tenantId,
        entityType: 'artifact',
        entityId: fileId,
        eventType: 'ARTIFACT_REPLACED',
        actorType: actorTypeFromRole(adminCtx.roleId, adminCtx.userId),
        actorId: adminCtx.userId,
        metadata: { orderId, artifactVersion: nextVersion },
        correlationId: orderId,
      });
    }
    return replaced;
  }

  async workshopList(adminCtx: AuthContext): Promise<PersistedOrder[]> {
    this.assertWorkshop(adminCtx);
    return this.orders.listOrders(adminCtx.tenantId, 'admin');
  }

  async events(orderId: string): Promise<OrderNotificationEvent[]> {
    return this.store.listEvents(orderId);
  }

  private async viewOf(order: PersistedOrder, ctx?: AuthContext): Promise<CustomerOrderView> {
    const events = await this.store.listEvents(order.orderId);
    const config = await this.adminRepo.getConfig(order.tenantId);
    const tenant = await this.adminRepo.getTenant();
    const currency = resolveConfiguredCurrency({
      currency: config?.identity?.currency || tenant?.currency || order.economicSnapshot?.currency,
    });
    let progress = undefined;
    try {
      const snap = await this.orchestrator?.snapshot(order.orderId);
      if (snap?.processes?.length) {
        const sorted = [...snap.processes].sort((a, b) => a.order - b.order);
        progress = [
          { id: 'received', label: 'Pedido recibido', state: 'done' as const },
          ...sorted.map((p) => ({
            id: p.processId,
            label: p.requiresApproval && p.status === 'waiting_approval' ? 'Aprobación' : p.name,
            state:
              p.status === 'completed'
                ? ('done' as const)
                : p.status === 'active' || p.status === 'waiting_approval'
                  ? ('current' as const)
                  : ('upcoming' as const),
          })),
        ];
      }
    } catch {
      progress = undefined;
    }
    const view = toCustomerOrderView(order, this.orders.deadlineFor(order).kind, events, { progress, currency });
    const inst = await this.workflows?.peek(order.orderId);
    if (inst?.blockedCustomerReason && inst.status === 'BLOCKED') {
      view.statusMessage = inst.blockedCustomerReason;
    }
    if (this.tracer && ctx) {
      try {
        const trace = await this.tracer.timeline(ctx, order.orderId);
        if (trace.length) {
          view.history = trace.map((item) => ({
            at: item.at,
            label: item.title,
            note: item.detail || item.nextHint,
          }));
        }
      } catch {
        /* keep status-walk history */
      }
    }
    assertNoInternalLeak(view);
    return view;
  }

  private assertCustomer(ctx: AuthContext): void {
    if (ctx.roleId !== 'CUSTOMER') throw new AccessDeniedError();
  }

  private assertWorkshop(ctx: AuthContext): void {
    if (ctx.roleId === 'CUSTOMER' || ctx.roleId === 'SUPER_ADMIN') throw new AccessDeniedError();
  }

  private async requireProfile(customerId: string): Promise<CustomerProfile> {
    const profile = await this.store.getCustomer(customerId);
    if (!profile) throw new AccessDeniedError();
    return profile;
  }

  private async audit(
    tenantId: string,
    actorId: string,
    action: string,
    target: string,
    result: AuditEntry['result'],
    detail?: string
  ): Promise<void> {
    const entry: AuditEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      tenantId,
      actorId,
      action,
      target,
      result,
      detail: detail ? String(detail).slice(0, 200) : undefined,
    };
    await this.adminRepo.appendAudit(entry);
  }

  private async maybeNearDeadline(order: PersistedOrder): Promise<void> {
    const kind = this.orders.deadlineFor(order).kind;
    if (kind !== 'approaching_deadline' && kind !== 'deadline_today') return;
    const existing = await this.store.listEvents(order.orderId);
    if (existing.some((e) => e.type === 'ORDER_NEAR_DEADLINE')) return;
    await this.emit('ORDER_NEAR_DEADLINE', order, 'El pedido está próximo a vencer.');
  }

  private async onLifecycle(type: string, order: PersistedOrder): Promise<void> {
    const tenant = await this.adminRepo.getTenant();
    if (!tenant || tenant.tenantId !== order.tenantId) return;
    const mapped = type as OrderNotificationType;
    const labels: Partial<Record<OrderNotificationType, string>> = {
      ORDER_CREATED: 'Pedido creado',
      ORDER_RECEIVED: 'Pedido recibido',
      ORDER_STATUS_CHANGED: `Estado: ${CUSTOMER_STATUS_LABELS[order.status] || order.status}`,
      ORDER_NEAR_DEADLINE: 'El pedido está próximo a vencer.',
      ORDER_EXPIRED: 'Plazo vencido',
      ORDER_READY: 'Pedido listo',
      ORDER_COMPLETED: 'Pedido finalizado',
      ORDER_REVISION_REQUESTED: 'El taller solicitó modificar información del pedido.',
    };
    await this.emit(mapped, order, labels[mapped] || mapped);
  }

  private async emit(type: OrderNotificationType, order: PersistedOrder, message: string): Promise<void> {
    const event: OrderNotificationEvent = {
      id: randomUUID(),
      type,
      tenantId: order.tenantId,
      orderId: order.orderId,
      customerId: order.customerId,
      at: Date.now(),
      message,
      channelHints: ['email', 'whatsapp', 'push', 'in_app'],
    };
    await this.store.appendEvent(event);
  }
}

function sanitizeValues(values: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (FORBIDDEN_VALUE_KEYS.has(key)) continue;
    next[key] = value;
  }
  return next;
}

function isAllowedFile(filename: string, mimeType: string): boolean {
  if (mimeType.startsWith('image/')) return true;
  const allowed = new Set([
    'application/pdf',
    'application/postscript',
    'application/octet-stream',
    'application/zip',
    'application/x-zip-compressed',
    'application/illustrator',
  ]);
  if (allowed.has(mimeType)) return true;
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'pdf', 'ai', 'psd', 'zip', 'tif', 'tiff'].includes(ext);
}

function matchesFilter(view: CustomerOrderView, filter: CustomerListFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'expired') return view.status === 'expired' || view.deadlineKind === 'expired';
  if (filter === 'finished') return FINISHED_STATUSES.includes(view.status);
  if (filter === 'cancelled') return CANCELLED_STATUSES.includes(view.status);
  return ACTIVE_STATUSES.includes(view.status);
}
