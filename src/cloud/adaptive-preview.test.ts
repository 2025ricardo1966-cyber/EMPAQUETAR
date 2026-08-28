import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ALL_PERMISSIONS, CUSTOMER_DEFAULT_PERMISSIONS, type AuthContext } from '../contracts/admin-domain';
import { ClientPortalService } from '../main/services/ClientPortalService';
import { WorkshopCatalogService } from '../main/services/WorkshopCatalogService';
import { bootControlPlane, stopControlPlane, type ControlPlaneKernel } from './kernel';
import type { OjoSession } from '../contracts/visual-interpreter';
import { libraryItemId } from '../contracts/workshop-catalog-domain';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let kernel: ControlPlaneKernel;
let portal: ClientPortalService;
let adminCtx: AuthContext;
let customerCtx: AuthContext;
let catalog: WorkshopCatalogService;

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
    organizationName: 'Taller Preview',
    principalLogin: 'admin-preview@example.com',
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
  catalog = new WorkshopCatalogService(kernel.store);
  await catalog.setCategory(adminCtx, 'SUBLIMACION', true);
  const registered = await portal.register({
    tenantId: adminCtx.tenantId,
    email: 'cliente-preview@example.com',
    password: 'secret-pass',
    name: 'Cliente Preview',
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

async function uploadPng(orderId: string) {
  return portal.uploadFile(customerCtx, orderId, {
    filename: 'diseno.png',
    mimeType: 'image/png',
    contentBase64: PNG_1X1,
  });
}

test('library: Bandera 2D, Remera 3D, Short de fútbol differentiated', async () => {
  const items = await catalog.listItems(adminCtx, false);
  const byKey = new Map(items.map((i) => [i.itemId, i]));
  const bandera = byKey.get(libraryItemId('bandera'));
  const remera = byKey.get(libraryItemId('remera-cuello-redondo'));
  const shortFutbol = byKey.get(libraryItemId('short-futbol'));
  const shortDeportivo = byKey.get(libraryItemId('short-deportivo'));
  const conjunto = byKey.get(libraryItemId('set-deportivo'));
  assert.equal(bandera?.name, 'Bandera');
  assert.equal(bandera?.previewMode, '2D');
  assert.equal(remera?.name, 'Remera cuello redondo');
  assert.equal(remera?.previewMode, '3D');
  assert.equal(remera?.moldId, 'remera-cuello-redondo');
  assert.equal(shortFutbol?.name, 'Short de fútbol');
  assert.equal(shortFutbol?.previewMode, '3D');
  assert.equal(shortFutbol?.moldId, 'short-futbol');
  assert.ok(shortDeportivo);
  assert.notEqual(shortFutbol?.itemId, shortDeportivo?.itemId);
  assert.equal(conjunto?.name, 'Conjunto deportivo');
  assert.equal(items.filter((i) => i.name === 'Set deportivo').length, 0);
  assert.equal(items.filter((i) => i.itemId === libraryItemId('short-futbol')).length, 1);
});

test('Bandera order uses planar 2D preview and 2D sample only', { timeout: 60_000 }, async () => {
  const created = await portal.createOrder(customerCtx, {
    workshopItemId: libraryItemId('bandera'),
    quantity: 1,
    projectName: 'Pedido Bandera',
  });
  const orderId = String(created.orderId || created.id);
  assert.equal(created.viewer?.previewMode, '2D');
  assert.equal(created.configuration?.previewMode, '2D');
  const uploaded = await uploadPng(orderId);
  const ready = await portal.interpretOjo(customerCtx, orderId, {
    fileId: String(uploaded.id),
    region: { shape: 'rect', x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
    hints: ['DISENO'],
  });
  assert.equal(ready.viewer.previewMode, '2D');
  assert.equal(ready.sample2d.available, true);
  assert.equal(ready.sample3d.available, false);
  assert.ok(ready.sample2d.fileId);
});

test('Remera order uses 3D preview with real OJO design applied', { timeout: 60_000 }, async () => {
  const created = await portal.createOrder(customerCtx, {
    workshopItemId: libraryItemId('remera-cuello-redondo'),
    quantity: 1,
    projectName: 'Pedido Remera',
  });
  const orderId = String(created.orderId || created.id);
  assert.equal(created.viewer?.previewMode, '3D');
  assert.equal(created.viewer?.moldId, 'remera-cuello-redondo');
  const uploaded = await uploadPng(orderId);
  const ready = await portal.interpretOjo(customerCtx, orderId, {
    fileId: String(uploaded.id),
    region: { shape: 'rect', x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
    hints: ['DISENO'],
  });
  const session = ready.ojoSession as OjoSession;
  assert.equal(ready.viewer.previewMode, '3D');
  assert.equal(ready.viewer.moldId, 'remera-cuello-redondo');
  assert.equal(ready.viewer.appliedDesignFileId, session.sample2dFileId);
  assert.equal(ready.sample3d.available, true);
  assert.ok(ready.sample3d.fileId);
});

test('Short de fútbol stays an independent 3D product', { timeout: 60_000 }, async () => {
  const created = await portal.createOrder(customerCtx, {
    workshopItemId: libraryItemId('short-futbol'),
    quantity: 1,
    projectName: 'Pedido Short Futbol',
  });
  const orderId = String(created.orderId || created.id);
  assert.equal(created.productKey, 'short-futbol');
  assert.equal(created.viewer?.previewMode, '3D');
  assert.equal(created.viewer?.moldId, 'short-futbol');
  const uploaded = await uploadPng(orderId);
  const ready = await portal.interpretOjo(customerCtx, orderId, {
    fileId: String(uploaded.id),
    hints: ['DISENO'],
  });
  assert.equal(ready.viewer.productKey, 'short-futbol');
  assert.equal(ready.viewer.moldId, 'short-futbol');
  assert.equal(ready.sample3d.available, true);
});

test('approval is bound to the presented visual version', { timeout: 60_000 }, async () => {
  const created = await portal.createOrder(customerCtx, {
    workshopItemId: libraryItemId('remera-cuello-redondo'),
    quantity: 1,
    projectName: 'Pedido Aprobacion',
  });
  const orderId = String(created.orderId || created.id);
  const uploaded = await uploadPng(orderId);
  await portal.interpretOjo(customerCtx, orderId, {
    fileId: String(uploaded.id),
    region: { shape: 'rect', x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
    hints: ['DISENO'],
  });
  const approved = await portal.decidePreview3D(customerCtx, orderId, { status: 'APPROVED' });
  assert.equal(approved.previewApproved, true);
  assert.equal(approved.previewApprovalValid, true);
  const version = approved.configuration?.visualVersion;
  assert.ok(version);
  const next = await portal.interpretOjo(customerCtx, orderId, {
    fileId: String(uploaded.id),
    region: { shape: 'rect', x: 0.4, y: 0.4, w: 0.3, h: 0.3 },
    hints: ['DISENO'],
  });
  assert.equal(next.previewApproved, false);
  assert.equal(next.previewApprovalValid, false);
  assert.notEqual(next.configuration?.visualVersion, version);
});
