import type { FormFieldConfig, StatusPresentation, TenantConfig } from '../../contracts/admin-domain';
import { LAUNCH_DEFAULTS } from '../../contracts/international-domain';
import type { OrderStatus } from '../../contracts/order-domain';
import { DEFAULT_DEADLINE_POLICY } from '../../contracts/order-domain';
import { DEFAULT_UNIT_CATALOG } from '../../contracts/catalog-domain';
import { DEFAULT_TENANT_LIMITS } from '../../contracts/auth-rbac';

const ORDER_STATUSES: OrderStatus[] = [
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
  'completed',
  'delivered',
  'cancelled',
  'expired',
];

function fieldsFor(disciplineId: string, items: Omit<FormFieldConfig, 'disciplineId'>[]): FormFieldConfig[] {
  return items.map((item) => ({ ...item, disciplineId }));
}

export function defaultTenantConfig(tenantId: string, now: number = Date.now()): TenantConfig {
  const textileFields = fieldsFor('textile', [
    { fieldId: 'discipline', name: 'discipline', key: 'discipline', label: 'Rubro', type: 'select', required: true, visible: true, editable: true, sensitive: false, order: 1, options: ['textile', 'tpu', 'dtf', 'other'] },
    { fieldId: 'product', name: 'product', key: 'product', label: 'Producto', type: 'text', required: false, visible: true, editable: true, sensitive: false, order: 2 },
    { fieldId: 'productKind', name: 'productKind', key: 'productKind', label: 'Tipo de producto', type: 'select', required: false, visible: true, editable: true, sensitive: false, order: 3, optionItems: [{ id: 'remera', label: 'Remera' }, { id: 'bandera', label: 'Bandera' }] },
    { fieldId: 'quantity', name: 'quantity', key: 'quantity', label: 'Cantidad', type: 'quantity', required: true, visible: true, editable: true, sensitive: false, order: 4 },
    { fieldId: 'material', name: 'material', key: 'material', label: 'Tela', type: 'material', required: true, visible: true, editable: true, sensitive: false, order: 5 },
    { fieldId: 'talle', name: 'talle', key: 'talle', label: 'Talle', type: 'select', required: false, visible: true, editable: true, sensitive: false, order: 6, optionItems: [{ id: 'S', label: 'S' }, { id: 'M', label: 'M' }, { id: 'L', label: 'L' }], dependsOn: { fieldId: 'productKind', equals: 'remera' } },
    { fieldId: 'measures', name: 'measures', key: 'measures', label: 'Medidas', type: 'text', required: false, visible: true, editable: true, sensitive: false, order: 7, dependsOn: { fieldId: 'productKind', equals: 'bandera' } },
    { fieldId: 'artwork', name: 'artwork', key: 'artwork', label: 'Archivo', type: 'file', required: false, visible: true, editable: true, sensitive: false, order: 8 },
    { fieldId: 'deliveryDate', name: 'deliveryDate', key: 'deliveryDate', label: 'Fecha de entrega', type: 'date', required: false, visible: true, editable: true, sensitive: false, order: 9 },
    { fieldId: 'notes', name: 'notes', key: 'notes', label: 'Observaciones', type: 'textarea', required: false, visible: true, editable: true, sensitive: false, order: 10 },
    { fieldId: 'internal_cost', name: 'internal_cost', key: 'internal_cost', label: 'Costo interno', type: 'number', required: false, visible: true, editable: true, sensitive: true, customerVisible: false, adminVisible: true, order: 11 },
  ]);
  const tpuFields = fieldsFor('tpu', [
    { fieldId: 'discipline', name: 'discipline', key: 'discipline', label: 'Rubro', type: 'select', required: true, visible: true, editable: true, sensitive: false, order: 1, options: ['tpu'] },
    { fieldId: 'product', name: 'product', key: 'product', label: 'Producto', type: 'text', required: false, visible: true, editable: true, sensitive: false, order: 2 },
    { fieldId: 'tpu_film', name: 'tpu_film', key: 'tpu_film', label: 'Material TPU', type: 'material', required: true, visible: true, editable: true, sensitive: false, order: 3 },
    { fieldId: 'meters', name: 'meters', key: 'meters', label: 'Cantidad', type: 'quantity', required: true, visible: true, editable: true, sensitive: false, order: 4 },
    { fieldId: 'measures', name: 'measures', key: 'measures', label: 'Medidas', type: 'text', required: false, visible: true, editable: true, sensitive: false, order: 5 },
    { fieldId: 'artwork', name: 'artwork', key: 'artwork', label: 'Archivo', type: 'file', required: false, visible: true, editable: true, sensitive: false, order: 6 },
    { fieldId: 'deliveryDate', name: 'deliveryDate', key: 'deliveryDate', label: 'Fecha de entrega', type: 'date', required: false, visible: true, editable: true, sensitive: false, order: 7 },
    { fieldId: 'notes', name: 'notes', key: 'notes', label: 'Observaciones', type: 'textarea', required: false, visible: true, editable: true, sensitive: false, order: 8 },
    { fieldId: 'internal_cost', name: 'internal_cost', key: 'internal_cost', label: 'Costo interno', type: 'number', required: false, visible: true, editable: true, sensitive: true, customerVisible: false, order: 9 },
  ]);
  const dtfFields = fieldsFor('dtf', [
    { fieldId: 'discipline', name: 'discipline', key: 'discipline', label: 'Rubro', type: 'select', required: true, visible: true, editable: true, sensitive: false, order: 1, options: ['dtf'] },
    { fieldId: 'product', name: 'product', key: 'product', label: 'Producto', type: 'text', required: false, visible: true, editable: true, sensitive: false, order: 2 },
    { fieldId: 'dtf_film', name: 'dtf_film', key: 'dtf_film', label: 'Material', type: 'material', required: true, visible: true, editable: true, sensitive: false, order: 3 },
    { fieldId: 'sheets', name: 'sheets', key: 'sheets', label: 'Cantidad', type: 'quantity', required: true, visible: true, editable: true, sensitive: false, order: 4 },
    { fieldId: 'measures', name: 'measures', key: 'measures', label: 'Medidas', type: 'text', required: false, visible: true, editable: true, sensitive: false, order: 5 },
    { fieldId: 'artwork', name: 'artwork', key: 'artwork', label: 'Archivo', type: 'file', required: false, visible: true, editable: true, sensitive: false, order: 6 },
    { fieldId: 'deliveryDate', name: 'deliveryDate', key: 'deliveryDate', label: 'Fecha de entrega', type: 'date', required: false, visible: true, editable: true, sensitive: false, order: 7 },
    { fieldId: 'notes', name: 'notes', key: 'notes', label: 'Observaciones', type: 'textarea', required: false, visible: true, editable: true, sensitive: false, order: 8 },
    { fieldId: 'internal_cost', name: 'internal_cost', key: 'internal_cost', label: 'Costo interno', type: 'number', required: false, visible: true, editable: true, sensitive: true, customerVisible: false, order: 9 },
  ]);

  const statusPresentation: StatusPresentation[] = ORDER_STATUSES.map((status, index) => ({
    status,
    enabled: true,
    label: status,
    order: index + 1,
    visibleToCustomer: !['expired', 'cancelled'].includes(status) || status === 'cancelled',
  }));

  return {
    tenantId,
    disciplines: [
      { id: 'textile', label: 'Textil', enabled: true },
      { id: 'tpu', label: 'TPU', enabled: true },
      { id: 'dtf', label: 'DTF', enabled: true },
      { id: 'other', label: 'Otro', enabled: true },
    ],
    fields: [...textileFields, ...tpuFields, ...dtfFields],
    identity: undefined,
    onboarding: { step: 1, adminSlots: 1, completed: false },
    betaNotice: { enabled: true, message: 'Esta es una versión Beta' },
    units: DEFAULT_UNIT_CATALOG,
    products: [],
    materials: [
      {
        materialId: 'tela-deportiva',
        name: 'Tela deportiva',
        unit: 'METRO',
        unitId: 'M',
        costType: 'PER_METER',
        internalUnitCost: 0,
        customerUnitPrice: 0,
        disciplineId: 'textile',
        active: true,
        customerVisibility: { price: true, consumption: true, subtotal: true, total: true },
      },
      {
        materialId: 'film-tpu',
        name: 'Film TPU',
        unit: 'METRO',
        unitId: 'M',
        costType: 'PER_METER',
        internalUnitCost: 0,
        customerUnitPrice: 0,
        disciplineId: 'tpu',
        active: true,
        customerVisibility: { price: true, consumption: true, subtotal: true, total: true },
      },
      {
        materialId: 'film-dtf',
        name: 'Film DTF',
        unit: 'M2',
        unitId: 'M2',
        costType: 'PER_M2',
        internalUnitCost: 0,
        customerUnitPrice: 0,
        disciplineId: 'dtf',
        active: true,
        customerVisibility: { price: true, consumption: true, subtotal: true, total: true },
      },
    ],
    statusPresentation,
    deadlineApproachingWithinMs: DEFAULT_DEADLINE_POLICY.approachingWithinMs,
    customerFieldAllowlist: [
      'discipline',
      'product',
      'productKind',
      'material',
      'quantity',
      'talle',
      'measures',
      'artwork',
      'deliveryDate',
      'notes',
      'tpu_film',
      'meters',
      'dtf_film',
      'sheets',
    ],
    formInstances: [],
    schemaCatalog: [],
    publishedSchema: {},
    processes: [
      { id: 'review', label: 'Revisión', enabled: true, type: 'review', order: 1, required: true, disciplineId: 'textile' },
      { id: 'edit', label: 'Edición', enabled: true, type: 'edit', order: 2, required: true, requiresApproval: true, disciplineId: 'textile' },
      { id: 'prepare', label: 'Preparación', enabled: true, type: 'prepare', order: 3, required: true, disciplineId: 'textile' },
      { id: 'print', label: 'Impresión', enabled: true, type: 'print', order: 4, required: true, disciplineId: 'textile' },
      { id: 'production', label: 'Producción', enabled: true, type: 'production', order: 5, required: true, disciplineId: 'textile' },
      { id: 'finish', label: 'Finalización', enabled: true, type: 'finish', order: 6, required: true, disciplineId: 'textile' },
      { id: 'tpu.review', label: 'Revisión TPU', enabled: true, type: 'review', order: 1, required: true, disciplineId: 'tpu' },
      { id: 'tpu.production', label: 'Producción TPU', enabled: true, type: 'production', order: 2, required: true, disciplineId: 'tpu' },
      { id: 'dtf.review', label: 'Revisión DTF', enabled: true, type: 'review', order: 1, required: true, disciplineId: 'dtf' },
      { id: 'dtf.production', label: 'Producción DTF', enabled: true, type: 'production', order: 2, required: true, disciplineId: 'dtf' },
    ],
    rules: [],
    updatedAt: now,
    setupDone: false,
    limits: { ...DEFAULT_TENANT_LIMITS },
    currency: LAUNCH_DEFAULTS.currency,
    defaultLanguage: LAUNCH_DEFAULTS.language,
    commercial: {
      defaultMarket: LAUNCH_DEFAULTS.country,
      defaultCurrency: LAUNCH_DEFAULTS.currency,
      defaultLanguage: LAUNCH_DEFAULTS.language,
    },
    workshopCategories: {
      SUBLIMACION: false,
      DTF_TEXTIL: false,
      UV_DTF: false,
      BORDADO: false,
      GRAN_FORMATO: false,
      TPU: false,
      OTRO: false,
    },
  };
}

export function emptySetupConfig(tenantId: string, now: number = Date.now()): TenantConfig {
  const base = defaultTenantConfig(tenantId, now);
  return {
    ...base,
    disciplines: base.disciplines.map((d) => ({ ...d, enabled: false })),
    fields: [],
    materials: [],
    products: [],
    processes: [],
    publishedSchema: {},
    setupDone: false,
    limits: { ...DEFAULT_TENANT_LIMITS },
  };
}
