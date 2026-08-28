import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ALL_PERMISSIONS, CUSTOMER_DEFAULT_PERMISSIONS, type AuthContext } from '../contracts/admin-domain';
import { RequestInvalidError } from '../contracts/configuration-schema';
import type { DesignDistribution } from '../contracts/design-distribution';
import { ClientPortalService } from '../main/services/ClientPortalService';
import { WorkshopCatalogService } from '../main/services/WorkshopCatalogService';
import { bootControlPlane, stopControlPlane, type ControlPlaneKernel } from './kernel';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ROSTER_CSV = Buffer.from('nombre,numero,talle,prenda,cantidad\nJuan,10,M,CAMISETA,1\n', 'utf8').toString(
  'base64'
);

let kernel: ControlPlaneKernel;
let portal: ClientPortalService;
let adminCtx: AuthContext;
let customerCtx: AuthContext;
let itemId: string;

function codeOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function prepareOrder(opts: {
  preview?: 'APPROVED' | 'RAW' | 'none';
  pay?: boolean;
}): Promise<string> {
  const created = await portal.createOrder(customerCtx, {
    workshopItemId: itemId,
    quantity: 1,
    projectName: 'Pedido de cierre',
  });
  const orderId = String(created.orderId || created.id);
  await portal.configureOrder(customerCtx, orderId, {
    garmentType: 'CAMISETA',
    sizeTableId: 'ref-camiseta-estandar',
  });
  await portal.uploadFile(customerCtx, orderId, {
    filename: 'plantel.csv',
    mimeType: 'text/csv',
    contentBase64: ROSTER_CSV,
  });
  await portal.reviewRoster(customerCtx, orderId, { approve: true });
  await portal.uploadFile(customerCtx, orderId, {
    filename: 'diseno.png',
    mimeType: 'image/png',
    contentBase64: PNG_1X1,
  });
  if (opts.preview === 'APPROVED') {
    await portal.decidePreview3D(customerCtx, orderId, { status: 'APPROVED' });
  } else if (opts.preview === 'RAW') {
    await portal.decidePreview3D(customerCtx, orderId, { status: 'RAW' });
  }
  if (opts.pay !== false) await portal.confirmPayment(adminCtx, orderId);
  return orderId;
}

function industrialFiles(files: Array<{ filename?: string; status?: string }>) {
  return files.filter((f) => {
    const name = String(f.filename || '').toLowerCase();
    return (
      f.status === 'VALIDATED' &&
      (name.endsWith('.json') || name.endsWith('.svg') || name.endsWith('.dxf') || name.endsWith('.pdf'))
    );
  });
}

before(async () => {
  kernel = await bootControlPlane({ listen: false });
  portal = new ClientPortalService(
    kernel.store,
    kernel.orders,
    kernel.portal,
    kernel.workshopAdmin,
    kernel.tracer,
    kernel.workflows,
    kernel.orchestrator
  );
  const activated = await kernel.activateAdmin.activate({
    organizationName: 'Taller Cierre',
    principalLogin: 'admin-cierre@example.com',
    principalPassword: 'secret-pass',
  });
  adminCtx = {
    token: 'admin',
    userId: activated.principal.userId,
    tenantId: activated.tenant.tenantId,
    roleId: 'ADMIN_PRINCIPAL',
    permissions: [...ALL_PERMISSIONS],
  };
  await kernel.workshopAdmin.completeDefaultOnboarding(adminCtx);
  const catalog = new WorkshopCatalogService(kernel.store);
  await catalog.setCategory(adminCtx, 'SUBLIMACION', true);
  const item = await catalog.createItem(adminCtx, {
    category: 'SUBLIMACION',
    name: 'Camiseta de prueba',
    price: 1000,
    unit: 'UNIDAD',
  });
  itemId = item.itemId;
  const registered = await portal.register({
    tenantId: adminCtx.tenantId,
    email: 'cliente-cierre@example.com',
    password: 'secret-pass',
    name: 'Cliente Cierre',
    country: 'AR',
    city: 'Buenos Aires',
  });
  customerCtx = {
    token: 'customer',
    userId: registered.userId,
    tenantId: adminCtx.tenantId,
    roleId: 'CUSTOMER',
    permissions: [...CUSTOMER_DEFAULT_PERMISSIONS],
  };
});

after(async () => {
  if (kernel) await stopControlPlane(kernel);
});

test(
  'CASO 1: roster + diseño + pago sin preview ni RAW rechaza producción con PREVIEW_PENDING',
  { timeout: 120_000 },
  async () => {
    const orderId = await prepareOrder({ preview: 'none' });
    await assert.rejects(
      () => portal.submit(customerCtx, orderId),
      (err: unknown) => err instanceof RequestInvalidError && err.message === 'REQUEST_INVALID:PREVIEW_PENDING'
    );
    const files = await kernel.store.listOrderFiles(adminCtx.tenantId, orderId);
    assert.equal(industrialFiles(files).length, 0);
    const audit = await kernel.store.listAudit(adminCtx.tenantId);
    assert.equal(audit.filter((e) => e.action === 'OUTPUT_GENERATED' && e.target === orderId).length, 0);
    const jobs = await kernel.store.listJobs({ orderId, tenantId: adminCtx.tenantId });
    assert.equal(jobs.filter((j) => j.status === 'completed').length, 0);
  }
);

test(
  'CASO 2: preview APPROVED + seña genera outputs reales en order_files',
  { timeout: 120_000 },
  async () => {
    const orderId = await prepareOrder({ preview: 'APPROVED' });
    const submitted = await portal.submit(customerCtx, orderId);
    assert.equal(submitted.orderId, orderId);
    assert.ok(Array.isArray(submitted.outputs) && submitted.outputs.length > 0);
    const files = await kernel.store.listOrderFiles(adminCtx.tenantId, orderId);
    const industrial = industrialFiles(files);
    assert.ok(industrial.length > 0, 'order_files must contain generated industrial outputs');
    assert.ok(industrial.some((f) => String(f.filename).toLowerCase().endsWith('.json')));
    const persisted = await kernel.orders.getOrder(orderId, 'admin');
    assert.ok(persisted);
    assert.ok((persisted.history || []).some((h) => h.note === 'outputs_generated'));
    const audit = await kernel.store.listAudit(adminCtx.tenantId);
    assert.ok(audit.some((e) => e.action === 'OUTPUT_GENERATED' && e.target === orderId));
    const jobs = await kernel.store.listJobs({ orderId, tenantId: adminCtx.tenantId });
    assert.equal(jobs.filter((j) => j.status === 'completed').length, 0);
  }
);

test(
  'CASO 3: RAW solicitada permite generación',
  { timeout: 120_000 },
  async () => {
    const orderId = await prepareOrder({ preview: 'RAW' });
    const submitted = await portal.submit(customerCtx, orderId);
    assert.equal(submitted.orderId, orderId);
    assert.ok(Array.isArray(submitted.outputs) && submitted.outputs.length > 0);
    const files = await kernel.store.listOrderFiles(adminCtx.tenantId, orderId);
    assert.ok(industrialFiles(files).length > 0);
    const order = await kernel.orders.getOrder(orderId, 'admin');
    assert.equal(!!order?.formValues?.rawMaterialRequested, true);
    assert.equal(!!order?.formValues?.previewApproved, false);
  }
);

test(
  'CASO 4: fallo de generación no falsifica éxito y deja OUTPUT_FAILED',
  { timeout: 120_000 },
  async () => {
    const orderId = await prepareOrder({ preview: 'APPROVED', pay: false });
    const order = await kernel.orders.getOrder(orderId, 'admin');
    assert.ok(order);
    const current = (order.formValues?.designDistribution || {}) as DesignDistribution;
    const distribution: DesignDistribution = {
      ...current,
      families: (current.families || []).map((family) => ({ ...family, units: 0, bySize: {} })),
      totalUnits: 0,
      records: [],
    };
    await kernel.orders.patchCustomerDraft(
      orderId,
      { actorId: customerCtx.userId, role: 'customer' },
      { formValues: { ...(order.formValues || {}), designDistribution: distribution } }
    );
    await assert.rejects(
      () => portal.generateProductionOutputs(customerCtx, orderId),
      (err: unknown) => codeOf(err).includes('OUTPUT_EMPTY')
    );
    const files = await kernel.store.listOrderFiles(adminCtx.tenantId, orderId);
    assert.equal(industrialFiles(files).length, 0);
    const fresh = await kernel.orders.getOrder(orderId, 'admin');
    const outputs = fresh?.formValues?.productionOutputs;
    assert.ok(!Array.isArray(outputs) || outputs.length === 0);
    const audit = await kernel.store.listAudit(adminCtx.tenantId);
    assert.ok(audit.some((e) => e.action === 'OUTPUT_FAILED' && e.target === orderId));
    assert.equal(audit.filter((e) => e.action === 'OUTPUT_GENERATED' && e.target === orderId).length, 0);
  }
);
