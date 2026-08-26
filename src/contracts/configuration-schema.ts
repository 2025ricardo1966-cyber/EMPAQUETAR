import type { ConfiguredMaterial, FormFieldConfig, FormFieldType, StatusPresentation } from './admin-domain';

export const FORM_FIELD_TYPES: FormFieldType[] = [
  'text',
  'textarea',
  'number',
  'decimal',
  'integer',
  'date',
  'datetime',
  'select',
  'multiselect',
  'boolean',
  'file',
  'image',
  'reference',
  'material',
  'quantity',
];

/** Reserved widgets — not rendered in B1-15. */
export const FUTURE_FIELD_TYPES = ['measure', 'area', 'table', 'list', 'composition'] as const;

export type FormViewer = 'customer' | 'operator' | 'subadmin' | 'admin';
export type SchemaPublicationStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface FieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  allowedExtensions?: string[];
  maxFileSize?: number;
}

export interface FieldAudience {
  customer: boolean;
  operator: boolean;
  subadmin: boolean;
  admin: boolean;
}

export interface FieldOption {
  id: string;
  label: string;
}

export interface ConfigRule {
  id: string;
  description?: string;
  enabled?: boolean;
  when: {
    fieldId?: string;
    equals?: string | number | boolean;
    greaterThan?: number;
    disciplineId?: string;
  };
  then: {
    show?: string[];
    hide?: string[];
    lockUnitFromMaterial?: boolean;
  };
}

export interface ProcessConfig {
  id: string;
  label: string;
  enabled: boolean;
  type?: string;
  order?: number;
  required?: boolean;
  requiresApproval?: boolean;
  requiredPermission?: string;
  disciplineId?: string;
  config?: Record<string, unknown>;
}

export interface ConfigurationSchema {
  schemaId: string;
  tenantId: string;
  disciplineId: string;
  version: number;
  label: string;
  status?: SchemaPublicationStatus;
  createdAt: number;
  fields: FormFieldConfig[];
  materials: ConfiguredMaterial[];
  processes: ProcessConfig[];
  statusPresentation: StatusPresentation[];
  rules: ConfigRule[];
  deadlineApproachingWithinMs?: number;
}

export interface FormFieldResponse {
  fieldId: string;
  key: string;
  value: unknown;
}

export interface FormInstance {
  instanceId: string;
  tenantId: string;
  schemaId: string;
  schemaVersion: number;
  rubricId: string;
  productId?: string;
  customerId?: string;
  status: 'draft' | 'submitted';
  responses: FormFieldResponse[];
  createdAt: number;
  updatedAt: number;
}

export interface OrderConfigurationSnapshot {
  schemaId: string;
  schemaVersion: number;
  disciplineId: string;
  capturedAt: number;
  fields: FormFieldConfig[];
  materials: Array<{
    materialId: string;
    name: string;
    unit: string;
    disciplineId: string;
    customerUnitPrice: number;
    internalUnitCost?: number;
  }>;
  rules: ConfigRule[];
  responses?: FormFieldResponse[];
  labels?: Record<string, string>;
  options?: Record<string, FieldOption[]>;
}

export interface CompiledForm {
  tenantId: string;
  disciplineId: string;
  schemaId: string;
  schemaVersion: number;
  schemaStatus?: SchemaPublicationStatus;
  viewer: FormViewer;
  fields: FormFieldConfig[];
  materials: Array<{
    materialId: string;
    name: string;
    unit: string;
    disciplineId: string;
    customerUnitPrice?: number;
  }>;
  products?: Array<{ productId: string; name: string; rubricId: string }>;
  processes: ProcessConfig[];
  statusPresentation: StatusPresentation[];
  rules: ConfigRule[];
}

const RESERVED_CUSTOMER_KEYS = new Set([
  'internalCost',
  'internal_cost',
  'internalUnitCost',
  'totalInternalCost',
  'margin',
  'permissions',
  'tenantId',
]);

export class RequestInvalidError extends Error {
  readonly code = 'REQUEST_INVALID';
  constructor(detail: string) {
    super(`REQUEST_INVALID:${detail}`);
    this.name = 'RequestInvalidError';
  }
}

export class ConfigValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    const first = Object.values(fields)[0] || 'VALIDATION_ERROR';
    super(first);
    this.name = 'ConfigValidationError';
    this.fields = fields;
  }
}

export class ConfigConflictError extends Error {
  readonly code = 'CONFIG_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'ConfigConflictError';
  }
}

export function fieldKey(field: FormFieldConfig): string {
  return field.key || field.name || field.fieldId;
}

export function fieldOptions(field: FormFieldConfig): FieldOption[] {
  if (field.optionItems && field.optionItems.length) {
    return field.optionItems.map((o) => ({ id: o.id, label: o.label }));
  }
  return (field.options || []).map((opt) =>
    typeof opt === 'string' ? { id: opt, label: opt } : { id: String((opt as FieldOption).id), label: String((opt as FieldOption).label) }
  );
}

export function defaultAudience(field: FormFieldConfig): FieldAudience {
  if (field.audience) {
    return {
      ...field.audience,
      customer: field.customerVisible ?? field.audience.customer,
      admin: field.adminVisible ?? field.audience.admin,
    };
  }
  const forCustomer = field.customerVisible ?? Boolean(field.visible && !field.sensitive);
  const forAdmin = field.adminVisible ?? true;
  return {
    customer: forCustomer,
    operator: Boolean(field.visible),
    subadmin: forCustomer,
    admin: forAdmin,
  };
}

export function fieldVisibleTo(field: FormFieldConfig, viewer: FormViewer): boolean {
  if (field.active === false && viewer !== 'admin') return false;
  if (!field.visible && viewer !== 'admin') return false;
  const audience = defaultAudience(field);
  if (viewer === 'customer' && (field.sensitive || field.customerVisible === false)) return false;
  if (viewer === 'admin' && field.adminVisible === false) return false;
  return audience[viewer];
}

export function operationalMaterials(
  materials: ConfiguredMaterial[],
  disciplineId: string,
  allowedIds?: string[]
): ConfiguredMaterial[] {
  return materials.filter((m) => {
    if (m.disciplineId !== disciplineId) return false;
    if (m.active === false || m.available === false) return false;
    if (allowedIds && allowedIds.length && !allowedIds.includes(m.materialId)) return false;
    return true;
  });
}

export function redactSchemaForViewer(
  schema: ConfigurationSchema,
  viewer: FormViewer
): CompiledForm {
  const fields = schema.fields
    .filter((f) => f.disciplineId === schema.disciplineId || !f.disciplineId)
    .filter((f) => fieldVisibleTo(f, viewer))
    .sort((a, b) => a.order - b.order)
    .map((f) => sanitizeField(f, viewer));
  const materials = operationalMaterials(schema.materials, schema.disciplineId).map((m) =>
    sanitizeMaterialOption(m, viewer)
  );
  const statusPresentation =
    viewer === 'customer'
      ? schema.statusPresentation.filter((s) => s.enabled && s.visibleToCustomer)
      : schema.statusPresentation.filter((s) => s.enabled);
  return {
    tenantId: schema.tenantId,
    disciplineId: schema.disciplineId,
    schemaId: schema.schemaId,
    schemaVersion: schema.version,
    schemaStatus: schema.status,
    viewer,
    fields,
    materials,
    processes: (schema.processes || []).filter((p) => p.enabled),
    statusPresentation,
    rules: schema.rules || [],
  };
}

export function sanitizeField(field: FormFieldConfig, viewer: FormViewer): FormFieldConfig {
  const copy: FormFieldConfig = {
    ...field,
    key: fieldKey(field),
    label: field.displayLabel || field.label,
    optionItems: fieldOptions(field),
  };
  if (viewer === 'customer' || viewer === 'operator') {
    delete copy.viewPermissions;
  }
  return copy;
}

export function sanitizeMaterialOption(
  material: ConfiguredMaterial,
  viewer: FormViewer
): { materialId: string; name: string; unit: string; disciplineId: string; customerUnitPrice?: number } {
  return {
    materialId: material.materialId,
    name: material.displayName || material.name,
    unit: material.unit,
    disciplineId: material.disciplineId,
    customerUnitPrice: viewer === 'admin' ? material.customerUnitPrice : undefined,
  };
}

export function applyConfigRules(
  fields: FormFieldConfig[],
  values: Record<string, unknown>,
  rules: ConfigRule[]
): FormFieldConfig[] {
  const hidden = new Set<string>();
  for (const field of fields) {
    if (!field.dependsOn?.fieldId) continue;
    const current = values[field.dependsOn.fieldId] ?? values[fieldKey(field)];
    if (field.dependsOn.equals !== undefined && current !== field.dependsOn.equals) {
      hidden.add(field.fieldId);
    }
  }
  for (const rule of rules || []) {
    if (rule.enabled === false) continue;
    const ok = matchRule(rule, values);
    if (!ok) {
      for (const id of rule.then.show || []) hidden.add(id);
      continue;
    }
    for (const id of rule.then.hide || []) hidden.add(id);
    for (const id of rule.then.show || []) hidden.delete(id);
  }
  if (hidden.size === 0) return fields;
  return fields.filter((f) => !hidden.has(f.fieldId) && !hidden.has(fieldKey(f)));
}

function matchRule(rule: ConfigRule, values: Record<string, unknown>): boolean {
  const { fieldId, equals, greaterThan } = rule.when;
  if (!fieldId) return true;
  const value = values[fieldId];
  if (equals !== undefined) return value === equals;
  if (greaterThan !== undefined) return Number(value) > greaterThan;
  return value !== undefined && value !== null && value !== '';
}

function emptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function asFileMeta(value: unknown): { artifactId?: string; filename?: string; size?: number } {
  if (typeof value === 'string') return { artifactId: value };
  if (value && typeof value === 'object') return value as { artifactId?: string; filename?: string; size?: number };
  return {};
}

export function responsesFromValues(fields: FormFieldConfig[], values: Record<string, unknown>): FormFieldResponse[] {
  return fields.map((field) => ({
    fieldId: field.fieldId,
    key: fieldKey(field),
    value: values[field.fieldId] ?? values[fieldKey(field)] ?? values[field.name] ?? null,
  }));
}

export function validateAgainstSchema(
  schema: Pick<ConfigurationSchema, 'fields' | 'rules' | 'materials'>,
  values: Record<string, unknown>,
  viewer: FormViewer = 'customer',
  context?: {
    productIds?: string[];
    customerIds?: string[];
    allowedMaterialIds?: string[];
  }
): void {
  const visible = applyConfigRules(
    schema.fields.filter((f) => fieldVisibleTo(f, viewer)),
    values,
    schema.rules || []
  ).sort((a, b) => a.order - b.order);

  if (viewer === 'customer') {
    for (const key of Object.keys(values || {})) {
      if (RESERVED_CUSTOMER_KEYS.has(key)) {
        throw new RequestInvalidError(`FORBIDDEN_FIELD:${key}`);
      }
    }
    const allowed = new Set<string>();
    for (const field of visible) {
      allowed.add(field.fieldId);
      allowed.add(fieldKey(field));
      allowed.add(field.name);
    }
    allowed.add('discipline');
    allowed.add('productId');
    allowed.add('disciplineId');
    for (const key of Object.keys(values || {})) {
      if (!allowed.has(key)) throw new RequestInvalidError(`UNKNOWN_FIELD:${key}`);
    }
    for (const field of schema.fields) {
      if (!field.sensitive && field.customerVisible !== false) continue;
      const sent = values[field.fieldId] ?? values[fieldKey(field)];
      if (!emptyValue(sent)) throw new RequestInvalidError(`SENSITIVE_FIELD:${field.fieldId}`);
    }
  }

  for (const field of visible) {
    const value = values[field.fieldId] ?? values[fieldKey(field)] ?? values[field.name];
    if (field.required && emptyValue(value)) {
      throw new RequestInvalidError(`REQUIRED_FIELD:${field.fieldId}`);
    }
    if (emptyValue(value)) continue;
    validateFieldValue(field, value, schema, context);
  }
}

function validateFieldValue(
  field: FormFieldConfig,
  value: unknown,
  schema: Pick<ConfigurationSchema, 'materials'>,
  context?: { productIds?: string[]; customerIds?: string[]; allowedMaterialIds?: string[] }
): void {
  const rules = field.validations || {};
  const type = field.type;
  if (type === 'integer') {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new RequestInvalidError(`TYPE:${field.fieldId}`);
  }
  if (type === 'number' || type === 'decimal' || type === 'integer' || type === 'quantity') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new RequestInvalidError(`TYPE:${field.fieldId}`);
    if (rules.min !== undefined && n < rules.min) throw new RequestInvalidError(`MIN:${field.fieldId}`);
    if (rules.max !== undefined && n > rules.max) throw new RequestInvalidError(`MAX:${field.fieldId}`);
  }
  if (type === 'boolean' && typeof value !== 'boolean' && value !== 'true' && value !== 'false' && value !== 0 && value !== 1) {
    throw new RequestInvalidError(`TYPE:${field.fieldId}`);
  }
  if ((type === 'date' || type === 'datetime') && Number.isNaN(Date.parse(String(value))) && !Number.isFinite(Number(value))) {
    throw new RequestInvalidError(`TYPE:${field.fieldId}`);
  }
  if (typeof value === 'string') {
    if (rules.minLength !== undefined && value.length < rules.minLength) {
      throw new RequestInvalidError(`MIN_LENGTH:${field.fieldId}`);
    }
    if (rules.maxLength !== undefined && value.length > rules.maxLength) {
      throw new RequestInvalidError(`MAX_LENGTH:${field.fieldId}`);
    }
    if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
      throw new RequestInvalidError(`PATTERN:${field.fieldId}`);
    }
  }
  if (type === 'select') {
    const ids = new Set(fieldOptions(field).map((o) => o.id));
    if (ids.size && !ids.has(String(value))) throw new RequestInvalidError(`OPTION:${field.fieldId}`);
  }
  if (type === 'multiselect') {
    const selected = Array.isArray(value) ? value.map(String) : [String(value)];
    const ids = new Set(fieldOptions(field).map((o) => o.id));
    if (!selected.length) throw new RequestInvalidError(`REQUIRED_FIELD:${field.fieldId}`);
    if (ids.size && selected.some((id) => !ids.has(id))) throw new RequestInvalidError(`OPTION:${field.fieldId}`);
  }
  if (type === 'file' || type === 'image') {
    const meta = asFileMeta(value);
    if (!meta.artifactId) throw new RequestInvalidError(`FILE:${field.fieldId}`);
    if (rules.maxFileSize && meta.size && meta.size > rules.maxFileSize) {
      throw new RequestInvalidError(`FILE_SIZE:${field.fieldId}`);
    }
    if (rules.allowedExtensions?.length && meta.filename) {
      const ext = meta.filename.split('.').pop()?.toLowerCase() || '';
      if (!rules.allowedExtensions.map((e) => e.replace('.', '').toLowerCase()).includes(ext)) {
        throw new RequestInvalidError(`FILE_TYPE:${field.fieldId}`);
      }
    }
  }
  if (type === 'material' || (type === 'reference' && field.referenceKind === 'material')) {
    const materialId = String(value);
    const allowed = operationalMaterials(schema.materials || [], field.disciplineId, context?.allowedMaterialIds);
    if (!allowed.some((m) => m.materialId === materialId)) {
      throw new RequestInvalidError('MATERIAL_UNAVAILABLE');
    }
  }
  if (type === 'reference' && field.referenceKind === 'product') {
    const id = String(value);
    if (context?.productIds && !context.productIds.includes(id)) {
      throw new RequestInvalidError(`REFERENCE:${field.fieldId}`);
    }
  }
  if (type === 'reference' && field.referenceKind === 'customer') {
    const id = String(value);
    if (context?.customerIds && !context.customerIds.includes(id)) {
      throw new RequestInvalidError(`REFERENCE:${field.fieldId}`);
    }
  }
}

export function validateSchemaForPublish(schema: ConfigurationSchema): void {
  const active = schema.fields.filter((f) => f.active !== false);
  if (!active.length) throw new RequestInvalidError('EMPTY_SCHEMA');
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const field of active) {
    const key = fieldKey(field);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) throw new RequestInvalidError(`KEY_INVALID:${field.fieldId}`);
    if (keys.has(key)) throw new RequestInvalidError(`KEY_CONFLICT:${key}`);
    keys.add(key);
    if (!field.fieldId || ids.has(field.fieldId)) throw new RequestInvalidError(`FIELD_ID:${field.fieldId}`);
    ids.add(field.fieldId);
    if (!String(field.label || '').trim()) throw new RequestInvalidError(`LABEL:${field.fieldId}`);
    if (!FORM_FIELD_TYPES.includes(field.type)) throw new RequestInvalidError(`TYPE_UNSUPPORTED:${field.fieldId}`);
    if ((field.type === 'select' || field.type === 'multiselect') && fieldOptions(field).length === 0) {
      throw new RequestInvalidError(`OPTIONS:${field.fieldId}`);
    }
    if (field.type === 'reference' && !field.referenceKind) {
      throw new RequestInvalidError(`REFERENCE_KIND:${field.fieldId}`);
    }
    const optionIds = new Set<string>();
    for (const opt of fieldOptions(field)) {
      if (!opt.id || optionIds.has(opt.id)) throw new RequestInvalidError(`OPTION_ID:${field.fieldId}`);
      optionIds.add(opt.id);
      if (!opt.label?.trim()) throw new RequestInvalidError(`OPTION_LABEL:${field.fieldId}`);
    }
  }
}

export function snapshotFromSchema(
  schema: ConfigurationSchema,
  now: number = Date.now(),
  values: Record<string, unknown> = {}
): OrderConfigurationSnapshot {
  const labels: Record<string, string> = {};
  const options: Record<string, FieldOption[]> = {};
  for (const field of schema.fields) {
    labels[field.fieldId] = field.displayLabel || field.label;
    const opts = fieldOptions(field);
    if (opts.length) options[field.fieldId] = opts;
  }
  return {
    schemaId: schema.schemaId,
    schemaVersion: schema.version,
    disciplineId: schema.disciplineId,
    capturedAt: now,
    fields: schema.fields.map((f) => ({ ...f })),
    materials: schema.materials.map((m) => ({
      materialId: m.materialId,
      name: m.name,
      unit: m.unit,
      disciplineId: m.disciplineId,
      customerUnitPrice: m.customerUnitPrice,
      internalUnitCost: m.internalUnitCost,
    })),
    rules: [...(schema.rules || [])],
    responses: responsesFromValues(schema.fields, values),
    labels,
    options,
  };
}

export function redactSnapshotForCustomer(
  snapshot: OrderConfigurationSnapshot
): OrderConfigurationSnapshot {
  const visibleIds = new Set(snapshot.fields.filter((f) => fieldVisibleTo(f, 'customer')).map((f) => f.fieldId));
  return {
    ...snapshot,
    fields: snapshot.fields.filter((f) => fieldVisibleTo(f, 'customer')),
    materials: snapshot.materials.map((m) => ({
      materialId: m.materialId,
      name: m.name,
      unit: m.unit,
      disciplineId: m.disciplineId,
      customerUnitPrice: m.customerUnitPrice,
    })),
    rules: [],
    responses: (snapshot.responses || []).filter((r) => visibleIds.has(r.fieldId)),
  };
}
