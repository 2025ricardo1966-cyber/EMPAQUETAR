import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ALL_PERMISSIONS, CUSTOMER_DEFAULT_PERMISSIONS, type AuthContext } from '../contracts/admin-domain';
import { ClientPortalService } from '../main/services/ClientPortalService';
import { WorkshopCatalogService } from '../main/services/WorkshopCatalogService';
import { bootControlPlane, stopControlPlane, type ControlPlaneKernel } from './kernel';
import type { OjoDiagnosis, OjoSession } from '../contracts/visual-interpreter';

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
    organizationName: 'Taller OJO',
    principalLogin: 'admin-ojo@example.com',
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
    name: 'Camiseta OJO',
    price: 1000,
    unit: 'UNIDAD',
  });
  itemId = item.itemId;
  const registered = await portal.register({
    tenantId: adminCtx.tenantId,
    email: 'cliente-ojo@example.com',
    password: 'secret-pass',
    name: 'Cliente OJO',
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
  'OJO ingest: region + hint + scaleGraphic + original preserved + samples',
  { timeout: 120_000 },
  async () => {
    const created = await portal.createOrder(customerCtx, {
      workshopItemId: itemId,
      quantity: 1,
      projectName: 'Pedido OJO',
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
    await portal.configureOrder(customerCtx, orderId, { tpu: { width_mm: 50.8, height_mm: 50.8 } });
    const uploaded = await portal.uploadFile(customerCtx, orderId, {
      filename: 'diseno.png',
      mimeType: 'image/png',
      contentBase64: PNG_1X1,
    });
    const originalId = String(uploaded.id);
    const originalBytes = await kernel.store.readBlob(originalId);
    assert.ok(originalBytes?.length);

    const ambiguous = await portal.interpretOjo(customerCtx, orderId, {
      fileId: originalId,
      region: { shape: 'rect', x: 0.1, y: 0.15, w: 0.15, h: 0.2 },
    });
    const first = ambiguous.ojo as OjoDiagnosis;
    assert.equal(first.ambiguous, true);
    assert.equal(first.region?.shape, 'rect');
    assert.equal(first.action, 'ESCALAR_PREPARAR');

    const ready = await portal.interpretOjo(customerCtx, orderId, {
      fileId: originalId,
      region: { shape: 'ellipse', x: 0.1, y: 0.15, w: 0.15, h: 0.2 },
      hints: ['NUMERO'],
    });
    const session = ready.ojoSession as OjoSession;
    const current = ready.ojo as OjoDiagnosis;
    assert.equal(current.ambiguous, false);
    assert.equal(current.region?.shape, 'ellipse');
    assert.deepEqual(current.hints, ['NUMERO']);
    assert.ok(session.transformation?.derivedFileId);
    assert.notEqual(session.transformation?.derivedFileId, originalId);
    assert.equal(session.originalFileId, originalId);
    assert.equal(ready.sample2d.available, true);
    assert.equal(ready.sample2d.fileId, session.transformation?.derivedFileId);
    assert.equal(typeof ready.sample3d.available, 'boolean');
    assert.equal(ready.continueToProduction, true);

    const stillOriginal = await kernel.store.readBlob(originalId);
    assert.deepEqual(stillOriginal, originalBytes);

    const files = await kernel.store.listOrderFiles(adminCtx.tenantId, orderId);
    const derived = files.find((f) => f.id === session.transformation?.derivedFileId);
    assert.ok(derived);
    assert.equal(derived.status, 'PENDING');
    assert.equal(files.filter((f) => f.id === originalId).length, 1);

    const timeline = await kernel.tracer.timeline(customerCtx, orderId);
    const types = timeline.map((e) => e.eventType);
    assert.ok(types.includes('OJO_EVALUATED'));
    assert.ok(types.includes('OJO_REGION_SELECTED'));
    assert.ok(types.includes('OJO_HINT_APPLIED'));
    assert.ok(types.includes('OJO_TRANSFORMED'));
    assert.ok(types.includes('OJO_REANALYZED'));

    const persisted = await kernel.orders.getOrder(orderId, 'admin');
    assert.equal(persisted?.formValues?.designFileId, originalId);
    const industrial = files.filter((f) => f.status === 'VALIDATED');
    assert.equal(industrial.length, 0);
  }
);
