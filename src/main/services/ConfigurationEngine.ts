import { randomUUID } from 'crypto';
import type { AuthContext, FormFieldConfig, Tenant, TenantConfig } from '../../contracts/admin-domain';
import { AccessDeniedError, hasPermission } from '../../contracts/admin-domain';
import type {
  CompiledForm,
  ConfigurationSchema,
  ConfigRule,
  FormInstance,
  FormViewer,
} from '../../contracts/configuration-schema';
import {
  applyConfigRules,
  fieldKey,
  operationalMaterials,
  redactSchemaForViewer,
  RequestInvalidError,
  responsesFromValues,
  snapshotFromSchema,
  validateAgainstSchema,
  validateSchemaForPublish,
} from '../../contracts/configuration-schema';
import { calculateMaterialCost } from '../../contracts/order-lifecycle';
import type { AdminRepository } from './AdminRepository';
import type { OrderService } from './OrderService';
import type { CreateOrderRequest, PersistedOrder } from '../../contracts/order-domain';
import { DEFAULT_CUSTOMER_VISIBILITY } from '../../contracts/order-domain';
import { resolveConfiguredCurrency } from '../../contracts/international-domain';
import { CostEngine } from './CostEngine';

/**
 * Cloud-ready configuration service. Persistence is injected (repository),
 * never a Windows filesystem path.
 */
export class ConfigurationEngine {
  constructor(
    private repo: AdminRepository,
    private orders?: OrderService
  ) {}

  async upsertDiscipline(
    tenantId: string,
    input: { id: string; label: string; enabled?: boolean }
  ): Promise<TenantConfig> {
    const config = await this.requireConfig(tenantId);
    const id = input.id.trim();
    if (!id) throw new RequestInvalidError('DISCIPLINE_ID');
    const existing = config.disciplines.find((d) => d.id === id);
    if (existing) {
      existing.label = input.label.trim() || existing.label;
      if (input.enabled !== undefined) existing.enabled = input.enabled;
    } else {
      config.disciplines.push({
        id,
        label: input.label.trim() || id,
        enabled: input.enabled !== false,
      });
    }
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    return config;
  }

  async setDisciplineEnabled(tenantId: string, disciplineId: string, enabled: boolean): Promise<TenantConfig> {
    const config = await this.requireConfig(tenantId);
    const row = config.disciplines.find((d) => d.id === disciplineId);
    if (!row) throw new RequestInvalidError('UNKNOWN_DISCIPLINE');
    row.enabled = enabled;
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    return config;
  }

  async compileLiveSchema(tenantId: string, disciplineId: string): Promise<ConfigurationSchema> {
    const config = await this.requireConfig(tenantId);
    const discipline = config.disciplines.find((d) => d.id === disciplineId);
    if (!discipline) throw new RequestInvalidError('UNKNOWN_DISCIPLINE');
    const published = this.publishedOf(config, disciplineId);
    return {
      schemaId: published?.schemaId || `${disciplineId}-schema`,
      tenantId,
      disciplineId,
      version: published?.version || 0,
      status: 'DRAFT',
      label: `${discipline.label} draft`,
      createdAt: config.updatedAt,
      fields: config.fields.filter((f) => f.disciplineId === disciplineId),
      materials: config.materials.filter((m) => m.disciplineId === disciplineId),
      processes: (config.processes || []).filter(
        (p) => p.disciplineId === disciplineId || p.id.startsWith(`${disciplineId}.`) || p.id === disciplineId
      ),
      statusPresentation: config.statusPresentation,
      rules: (config.rules || []) as ConfigRule[],
      deadlineApproachingWithinMs: config.deadlineApproachingWithinMs,
    };
  }

  publishedOf(config: TenantConfig, disciplineId: string): ConfigurationSchema | undefined {
    const ref = config.publishedSchema?.[disciplineId];
    if (!ref) return undefined;
    const found = (config.schemaCatalog || []).find(
      (s) => s.schemaId === ref.schemaId && s.version === ref.version && s.tenantId === config.tenantId
    ) as ConfigurationSchema | undefined;
    if (!found || found.status === 'ARCHIVED') return undefined;
    return found;
  }

  async listActiveProducts(tenantId: string, rubricId?: string) {
    const config = await this.requireConfig(tenantId);
    return (config.products || [])
      .filter(
        (p) =>
          p.active &&
          p.visibleToClient !== false &&
          p.tenantId === tenantId &&
          (!rubricId || p.rubricId === rubricId)
      )
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map((p) => ({
        productId: p.productId,
        id: p.productId,
        name: p.name,
        rubricId: p.rubricId,
        schemaId: p.schemaId,
        active: p.active,
        visibleToClient: p.visibleToClient !== false,
        displayOrder: p.displayOrder || 0,
        clientDescription: p.clientDescription || p.description || '',
        fields: (p.fields || []).filter((f) => f.visibleToClient !== false),
        unit: p.unitId || 'UNIT',
      }));
  }

  async listDrafts(tenantId: string, customerId: string): Promise<FormInstance[]> {
    const config = await this.requireConfig(tenantId);
    return (config.formInstances || []).filter(
      (i) => i.tenantId === tenantId && i.customerId === customerId && i.status === 'draft'
    );
  }

  async getDraft(tenantId: string, instanceId: string, customerId: string): Promise<FormInstance> {
    const config = await this.requireConfig(tenantId);
    const instance = (config.formInstances || []).find((i) => i.instanceId === instanceId && i.tenantId === tenantId);
    if (!instance || instance.customerId !== customerId) throw new AccessDeniedError();
    return instance;
  }

  async listEnabledDisciplines(tenantId: string): Promise<Array<{ id: string; label: string }>> {
    const config = await this.requireConfig(tenantId);
    return config.disciplines.filter((d) => d.enabled).map((d) => ({ id: d.id, label: d.label }));
  }

  async getPublishedSchema(tenantId: string, disciplineId: string): Promise<ConfigurationSchema> {
    const config = await this.requireConfig(tenantId);
    const published = this.publishedOf(config, disciplineId);
    if (!published || published.status === 'DRAFT' || published.status === 'ARCHIVED') {
      throw new RequestInvalidError('SCHEMA_NOT_PUBLISHED');
    }
    if (published.tenantId !== tenantId) throw new AccessDeniedError();
    return published;
  }

  async getSchema(
    tenantId: string,
    disciplineId: string,
    version?: number
  ): Promise<ConfigurationSchema> {
    const config = await this.requireConfig(tenantId);
    if (version && version > 0) {
      const found = (config.schemaCatalog || []).find(
        (s) => s.tenantId === tenantId && s.disciplineId === disciplineId && s.version === version
      );
      if (!found) throw new RequestInvalidError('SCHEMA_VERSION_NOT_FOUND');
      return found as ConfigurationSchema;
    }
    return this.publishedOf(config, disciplineId) || this.compileLiveSchema(tenantId, disciplineId);
  }

  async getFormSchema(
    tenantId: string,
    disciplineId: string,
    viewer: FormViewer,
    values: Record<string, unknown> = {},
    version?: number
  ): Promise<CompiledForm> {
    const config = await this.requireConfig(tenantId);
    const discipline = config.disciplines.find((d) => d.id === disciplineId);
    if (!discipline) throw new RequestInvalidError('UNKNOWN_DISCIPLINE');
    if (!discipline.enabled && viewer === 'customer') {
      throw new RequestInvalidError('DISCIPLINE_DISABLED');
    }
    const schema = await this.getSchema(tenantId, disciplineId, version);
    return this.compileForm(config, schema, viewer, values);
  }

  /** Same renderer compiler as customer, over the live (draft) field set. */
  async previewCustomerForm(tenantId: string, disciplineId: string, values: Record<string, unknown> = {}): Promise<CompiledForm> {
    const config = await this.requireConfig(tenantId);
    const live = await this.compileLiveSchema(tenantId, disciplineId);
    return this.compileForm(config, live, 'customer', values);
  }

  async getFormForProduct(
    tenantId: string,
    productId: string,
    viewer: FormViewer,
    values: Record<string, unknown> = {}
  ): Promise<CompiledForm> {
    const config = await this.requireConfig(tenantId);
    const product = (config.products || []).find((p) => p.productId === productId && p.tenantId === tenantId);
    if (!product || !product.active) throw new RequestInvalidError('PRODUCT_UNAVAILABLE');
    const disciplineId = product.rubricId;
    let schema: ConfigurationSchema;
    if (product.schemaId) {
      const found = (config.schemaCatalog || [])
        .filter((s) => s.tenantId === tenantId && s.schemaId === product.schemaId && s.status === 'PUBLISHED')
        .sort((a, b) => b.version - a.version)[0];
      schema = (found as ConfigurationSchema) || (await this.getPublishedSchema(tenantId, disciplineId));
    } else if (viewer === 'customer') {
      schema = this.publishedOf(config, disciplineId) || (await this.compileLiveSchema(tenantId, disciplineId));
    } else {
      schema = await this.getSchema(tenantId, disciplineId);
    }
    const compiled = this.compileForm(config, schema, viewer, { ...values, productId });
    compiled.materials = operationalMaterials(config.materials, disciplineId, product.materialIds).map((m) => ({
      materialId: m.materialId,
      name: m.displayName || m.name,
      unit: m.unit,
      disciplineId: m.disciplineId,
      customerUnitPrice: viewer === 'admin' ? m.customerUnitPrice : undefined,
    }));
    return compiled;
  }

  async publishSchema(tenantId: string, disciplineId: string): Promise<ConfigurationSchema> {
    const config = await this.requireConfig(tenantId);
    const live = await this.compileLiveSchema(tenantId, disciplineId);
    validateSchemaForPublish(live);
    const previous = (config.schemaCatalog || [])
      .filter((s) => s.disciplineId === disciplineId)
      .reduce((max, s) => Math.max(max, s.version), 0);
    const catalog = [...(config.schemaCatalog || [])].map((s) =>
      s.disciplineId === disciplineId && s.status === 'PUBLISHED' ? { ...s, status: 'ARCHIVED' as const } : s
    );
    const published: ConfigurationSchema = {
      ...live,
      schemaId: `${disciplineId}-schema`,
      version: previous + 1,
      status: 'PUBLISHED',
      label: `${live.label.replace(' draft', '')} v${previous + 1}`,
      createdAt: Date.now(),
      fields: live.fields.map((f) => ({ ...f })),
      materials: live.materials.map((m) => ({ ...m })),
    };
    config.schemaCatalog = [...catalog, published];
    config.publishedSchema = {
      ...(config.publishedSchema || {}),
      [disciplineId]: { schemaId: published.schemaId, version: published.version },
    };
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    return published;
  }

  async archiveSchema(tenantId: string, disciplineId: string, version?: number): Promise<ConfigurationSchema> {
    const config = await this.requireConfig(tenantId);
    const targetVersion = version || config.publishedSchema?.[disciplineId]?.version;
    const index = (config.schemaCatalog || []).findIndex(
      (s) => s.tenantId === tenantId && s.disciplineId === disciplineId && s.version === targetVersion
    );
    if (index < 0) throw new RequestInvalidError('SCHEMA_VERSION_NOT_FOUND');
    const archived = { ...config.schemaCatalog![index], status: 'ARCHIVED' as const };
    config.schemaCatalog![index] = archived;
    if (config.publishedSchema?.[disciplineId]?.version === archived.version) {
      delete config.publishedSchema[disciplineId];
    }
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    return archived as ConfigurationSchema;
  }

  async validateForm(
    tenantId: string,
    disciplineId: string,
    values: Record<string, unknown>,
    viewer: FormViewer = 'customer',
    productId?: string
  ): Promise<void> {
    const config = await this.requireConfig(tenantId);
    const schema = await this.getSchema(tenantId, disciplineId);
    const product = productId
      ? (config.products || []).find((p) => p.productId === productId && p.tenantId === tenantId)
      : undefined;
    if (productId && (!product || !product.active)) throw new RequestInvalidError('PRODUCT_UNAVAILABLE');
    validateAgainstSchema(
      { ...schema, materials: config.materials },
      values,
      viewer,
      {
        productIds: (config.products || []).filter((p) => p.active && p.tenantId === tenantId).map((p) => p.productId),
        allowedMaterialIds: product?.materialIds,
      }
    );
  }

  async validateSubmission(
    tenantId: string,
    disciplineId: string,
    values: Record<string, unknown>,
    viewer: FormViewer = 'customer'
  ): Promise<void> {
    try {
      await this.validateForm(tenantId, disciplineId, values, viewer);
    } catch (error) {
      if (error instanceof RequestInvalidError && error.message.includes('REQUIRED_FIELD')) {
        throw new Error(error.message.replace('REQUEST_INVALID:', ''));
      }
      throw error;
    }
  }

  snapshotSchema(schema: ConfigurationSchema, values: Record<string, unknown> = {}) {
    return snapshotFromSchema(schema, Date.now(), values);
  }

  async createFormInstance(
    tenantId: string,
    input: { rubricId: string; productId?: string; customerId?: string; values?: Record<string, unknown> }
  ): Promise<FormInstance> {
    const config = await this.requireConfig(tenantId);
    const schema = input.productId
      ? await this.resolveProductSchema(config, input.productId)
      : await this.getPublishedSchema(tenantId, input.rubricId);
    const now = Date.now();
    const instance: FormInstance = {
      instanceId: randomUUID(),
      tenantId,
      schemaId: schema.schemaId,
      schemaVersion: schema.version,
      rubricId: schema.disciplineId,
      productId: input.productId,
      customerId: input.customerId,
      status: 'draft',
      responses: responsesFromValues(schema.fields, input.values || {}),
      createdAt: now,
      updatedAt: now,
    };
    config.formInstances = [...(config.formInstances || []), instance];
    config.updatedAt = now;
    await this.repo.saveConfig(config);
    return instance;
  }

  async saveFormResponse(
    tenantId: string,
    instanceId: string,
    values: Record<string, unknown>,
    viewer: FormViewer = 'customer'
  ): Promise<FormInstance> {
    void viewer;
    const config = await this.requireConfig(tenantId);
    const instance = (config.formInstances || []).find((i) => i.instanceId === instanceId && i.tenantId === tenantId);
    if (!instance) throw new RequestInvalidError('FORM_INSTANCE_NOT_FOUND');
    if (instance.status !== 'draft') throw new RequestInvalidError('FORM_INSTANCE_SUBMITTED');
    const schema = await this.getSchema(tenantId, instance.rubricId, instance.schemaVersion);
    instance.responses = responsesFromValues(schema.fields, values);
    instance.updatedAt = Date.now();
    config.updatedAt = instance.updatedAt;
    await this.repo.saveConfig(config);
    return instance;
  }

  async deactivateField(tenantId: string, disciplineId: string, fieldId: string): Promise<TenantConfig> {
    const config = await this.requireConfig(tenantId);
    const field = config.fields.find((f) => f.fieldId === fieldId && f.disciplineId === disciplineId);
    if (!field) throw new RequestInvalidError('UNKNOWN_FIELD');
    field.active = false;
    field.visible = false;
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    return config;
  }

  async reorderFields(tenantId: string, disciplineId: string, fieldIds: string[]): Promise<TenantConfig> {
    const config = await this.requireConfig(tenantId);
    fieldIds.forEach((id, index) => {
      const field = config.fields.find((f) => f.fieldId === id && f.disciplineId === disciplineId);
      if (field) field.order = index + 1;
    });
    config.updatedAt = Date.now();
    await this.repo.saveConfig(config);
    return config;
  }

  async quoteLine(
    tenantId: string,
    disciplineId: string,
    materialId: string,
    quantity: number,
    includeInternal: boolean
  ): Promise<{ unit: string; quantity: number; customerAmount: number; internalCost?: number }> {
    const config = await this.requireConfig(tenantId);
    const material = operationalMaterials(config.materials, disciplineId).find((m) => m.materialId === materialId);
    if (!material) throw new RequestInvalidError('MATERIAL_UNAVAILABLE');
    const qty = Number(quantity);
    const customerAmount = calculateMaterialCost(qty, material.customerUnitPrice);
    return {
      unit: material.unit,
      quantity: qty,
      customerAmount,
      internalCost: includeInternal ? calculateMaterialCost(qty, material.internalUnitCost) : undefined,
    };
  }

  async submitOrder(
    ctx: AuthContext,
    input: {
      disciplineId: string;
      values: Record<string, unknown>;
      customerId: string;
      customerName: string;
      dueAt: number;
      priority?: CreateOrderRequest['priority'];
      summary?: string;
      initialStatus?: CreateOrderRequest['initialStatus'];
      attachments?: CreateOrderRequest['attachments'];
      visibility?: CreateOrderRequest['visibility'];
      approvalStatus?: CreateOrderRequest['approvalStatus'];
      productId?: string;
      instanceId?: string;
    }
  ): Promise<PersistedOrder> {
    if (!this.orders) throw new Error('Order service unavailable');
    const config = await this.requireConfig(ctx.tenantId);
    const discipline = config.disciplines.find((d) => d.id === input.disciplineId);
    if (!discipline?.enabled) throw new RequestInvalidError('DISCIPLINE_DISABLED');
    const viewer: FormViewer = ctx.roleId === 'CUSTOMER' ? 'customer' : 'admin';
    const productId = input.productId || String(input.values.productId || '');
    await this.validateForm(ctx.tenantId, input.disciplineId, input.values, viewer, productId || undefined);
    const schema = await this.getSchema(ctx.tenantId, input.disciplineId);
    const snapshot = this.snapshotSchema(schema, input.values);
    const attachments = [...(input.attachments || [])];
    for (const field of schema.fields) {
      if (field.type !== 'file' && field.type !== 'image') continue;
      const raw = fieldValue(input.values, field);
      const artifactId =
        typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? String((raw as { artifactId?: string }).artifactId || '') : '';
      if (!artifactId) continue;
      if (!attachments.some((a) => a.fileId === artifactId)) {
        attachments.push({
          fileId: artifactId,
          storageReference: `cloud://artifacts/${artifactId}`,
          filename: typeof raw === 'object' && raw ? String((raw as { filename?: string }).filename || artifactId) : artifactId,
          mimeType: typeof raw === 'object' && raw ? String((raw as { mimeType?: string }).mimeType || 'application/octet-stream') : 'application/octet-stream',
          size: typeof raw === 'object' && raw ? Number((raw as { size?: number }).size || 0) : 0,
          createdAt: Date.now(),
          version: 1,
          current: true,
        });
      }
    }
    const materialField = schema.fields.find(
      (f) => (f.type === 'material' || (f.type === 'reference' && f.referenceKind === 'material')) && fieldValue(input.values, f) != null
    );
    const quantityField = schema.fields.find((f) => f.type === 'quantity' || f.type === 'integer' || fieldKey(f) === 'quantity');
    const consumptions = [];
    const product = productId ? (config.products || []).find((p) => p.productId === productId && p.tenantId === ctx.tenantId) : undefined;
    let visibility = input.visibility;
    if (materialField && quantityField) {
      const materialId = String(fieldValue(input.values, materialField));
      const quantity = Number(fieldValue(input.values, quantityField));
      const material = operationalMaterials(config.materials || schema.materials, input.disciplineId, product?.materialIds).find(
        (m) => m.materialId === materialId
      );
      if (!material) throw new RequestInvalidError('MATERIAL_UNAVAILABLE');
      visibility = visibility || {
        ...DEFAULT_CUSTOMER_VISIBILITY,
        consumption: material.visibility?.showConsumption !== false,
        customerAmount: material.visibility?.showCustomerPrice !== false,
        estimatedCost: material.visibility?.showCustomerPrice !== false,
        internalCost: false,
      };
      const engine = new CostEngine(this.repo, this.orders);
      const tenantProbe = {
        tenantId: ctx.tenantId,
        currency: resolveConfiguredCurrency({ currency: config.identity?.currency || config.currency }),
        identity: config.identity,
      } as Tenant;
      const quoted = engine.calculateQuote({
        tenant: tenantProbe,
        config,
        lines: [{ productId: product?.productId, materialId: material.materialId, requestedQuantity: quantity }],
      });
      consumptions.push(engine.toConsumption(quoted.lines[0]));
    }
    const order = await this.orders.createOrder({
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      customerName: input.customerName,
      summary: input.summary,
      priority: input.priority,
      dueAt: input.dueAt,
      actor: { actorId: ctx.userId, role: ctx.roleId === 'CUSTOMER' ? 'customer' : 'admin' },
      disciplineId: input.disciplineId,
      formValues: input.values,
      configurationSnapshot: snapshot,
      initialStatus: input.initialStatus ?? (ctx.roleId === 'CUSTOMER' ? 'received' : 'pending'),
      attachments,
      visibility,
      approvalStatus: input.approvalStatus,
    });
    for (const line of consumptions) {
      await this.orders.addConsumption(order.orderId, line);
    }
    if (input.instanceId) {
      const instance = (config.formInstances || []).find((i) => i.instanceId === input.instanceId && i.tenantId === ctx.tenantId);
      if (instance) {
        instance.status = 'submitted';
        instance.responses = snapshot.responses || instance.responses;
        instance.updatedAt = Date.now();
        await this.repo.saveConfig(config);
      }
    }
    const saved = await this.orders.getOrder(order.orderId, 'admin');
    if (!saved) throw new Error('ORDER_PERSIST_FAILED');
    return saved;
  }

  assertProtectedFieldWrite(ctx: AuthContext, existing: FormFieldConfig | undefined, next: FormFieldConfig): void {
    if (!existing) return;
    if (existing.sensitive && next.sensitive === false && !hasPermission(
      {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        login: '',
        displayCode: '',
        roleId: ctx.roleId,
        permissions: ctx.permissions,
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
      },
      'sensitive_data.view'
    )) {
      throw new AccessDeniedError();
    }
  }

  private compileForm(
    config: TenantConfig,
    schema: ConfigurationSchema,
    viewer: FormViewer,
    values: Record<string, unknown>
  ): CompiledForm {
    const compiled = redactSchemaForViewer(schema, viewer);
    compiled.fields = applyConfigRules(compiled.fields, values, schema.rules || []);
    compiled.materials = operationalMaterials(config.materials || schema.materials, schema.disciplineId).map((m) => ({
      materialId: m.materialId,
      name: m.displayName || m.name,
      unit: m.unit,
      disciplineId: m.disciplineId,
      customerUnitPrice: viewer === 'admin' ? m.customerUnitPrice : undefined,
    }));
    compiled.products = (config.products || [])
      .filter((p) => p.active && p.tenantId === schema.tenantId && p.rubricId === schema.disciplineId)
      .map((p) => ({ productId: p.productId, name: p.name, rubricId: p.rubricId }));
    if (viewer === 'customer') compiled.rules = schema.rules || [];
    return compiled;
  }

  private async resolveProductSchema(config: TenantConfig, productId: string): Promise<ConfigurationSchema> {
    const product = (config.products || []).find((p) => p.productId === productId && p.tenantId === config.tenantId);
    if (!product || !product.active) throw new RequestInvalidError('PRODUCT_UNAVAILABLE');
    if (product.schemaId) {
      const found = (config.schemaCatalog || [])
        .filter((s) => s.tenantId === config.tenantId && s.schemaId === product.schemaId && s.status === 'PUBLISHED')
        .sort((a, b) => b.version - a.version)[0];
      if (found) return found as ConfigurationSchema;
    }
    return this.getPublishedSchema(config.tenantId, product.rubricId);
  }

  private async requireConfig(tenantId: string): Promise<TenantConfig> {
    const config = await this.repo.getConfig(tenantId);
    if (!config || config.tenantId !== tenantId) throw new AccessDeniedError();
    if (!config.schemaCatalog) config.schemaCatalog = [];
    if (!config.publishedSchema) config.publishedSchema = {};
    if (!config.formInstances) config.formInstances = [];
    return config;
  }
}

function fieldValue(values: Record<string, unknown>, field: FormFieldConfig): unknown {
  return values[field.fieldId] ?? values[field.key || field.name] ?? values[field.name];
}
