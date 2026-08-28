import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AccessDeniedError, ALL_PERMISSIONS, CUSTOMER_DEFAULT_PERMISSIONS, type AuthContext } from '../contracts/admin-domain';
import { RequestInvalidError } from '../contracts/configuration-schema';
import { assertCanGenerateOutputs } from '../contracts/order-production-output';
import { FLOW_FEATURE_KEYS } from '../contracts/flow-configuration';
import { discoverWorkshopCapabilities } from '../contracts/empaquetar-capabilities';
import { ClientPortalService } from '../main/services/ClientPortalService';
import { AdminConfigService } from '../main/services/AdminConfigService';
import { WorkshopCatalogService } from '../main/services/WorkshopCatalogService';
import { libraryItemId } from '../contracts/workshop-catalog-domain';
import { bootControlPlane, stopControlPlane, type ControlPlaneKernel } from './kernel';
import { adminForTenant } from './auth-helpers';

let kernel: ControlPlaneKernel;
let portal: ClientPortalService;
let flowCfg: AdminConfigService;
let adminA: AuthContext;
let adminB: AuthContext;
let customerA: AuthContext;
let customerB: AuthContext;

async function activateWorkshop(login: string, org: string, customerEmail: string) {
  const activated = await kernel.activateAdmin.activate({
    organizationName: org,
    principalLogin: login,
    principalPassword: 'secret-pass',
  });
  const adminCtx: AuthContext = {
    token: 'admin',
    userId: activated.principal.userId,
    tenantId: activated.tenant.tenantId,
    roleId: 'ADMIN_PRINCIPAL',
    permissions: [...ALL_PERMISSIONS],
  };
  const adminSvc = adminForTenant(kernel.store, activated.tenant.tenantId, kernel.orders, kernel.control);
  adminSvc.setTracer(kernel.tracer);
  await adminSvc.completeDefaultOnboarding(adminCtx);
  const registered = await portal.register({
    tenantId: adminCtx.tenantId,
    email: customerEmail,
    password: 'secret-pass',
    name: 'Cliente Flujo',
    country: 'AR',
    city: 'Buenos Aires',
  });
  const customerCtx: AuthContext = {
    token: 'customer',
    userId: registered.userId,
    tenantId: adminCtx.tenantId,
    roleId: 'CUSTOMER',
    permissions: [...CUSTOMER_DEFAULT_PERMISSIONS],
  };
  return { adminCtx, customerCtx };
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
  flowCfg = new AdminConfigService(kernel.workshopAdmin, kernel.orders, kernel.tracer, kernel.workflows);
  const a = await activateWorkshop('admin-flow-a@example.com', 'Taller Flujo A', 'cliente-flow-a@example.com');
  adminA = a.adminCtx;
  customerA = a.customerCtx;
  const b = await activateWorkshop('admin-flow-b@example.com', 'Taller Flujo B', 'cliente-flow-b@example.com');
  adminB = b.adminCtx;
  customerB = b.customerCtx;
});

after(async () => {
  if (kernel) await stopControlPlane(kernel);
});

test('available capabilities come from the EMPAQUETAR catalog', async () => {
  const view = await flowCfg.getFlowConfiguration(adminA);
  const discovered = discoverWorkshopCapabilities().map((row) => row.key).slice().sort();
  const returned = ((view as { capabilities?: Array<{ key: string; supported?: boolean }> }).capabilities || [])
    .map((row) => row.key)
    .slice()
    .sort();
  assert.deepEqual(returned, discovered);
  assert.equal(
    ((view as { capabilities?: Array<{ supported?: boolean }> }).capabilities || []).every((row) => row.supported),
    true
  );
  assert.equal((returned as string[]).includes('IMAGE_16K'), false);
  assert.equal((returned as string[]).includes('CANDY_BAR'), false);
  assert.equal((view as { catalog?: { source?: string; commercialEnforced?: boolean } }).catalog?.source, 'empaquetar-capabilities');
  assert.equal((view as { catalog?: { commercialEnforced?: boolean } }).catalog?.commercialEnforced, false);
});

test('nucleus capabilities cannot be turned off by the workshop admin', async () => {
  await flowCfg.putFlowConfiguration(adminA, {
    features: [
      { featureKey: 'orders', enabled: false },
      { featureKey: 'traceability', enabled: false },
    ],
  });
  const adminView = await flowCfg.getFlowConfiguration(adminA);
  const caps = (adminView as { capabilities?: Array<{ key: string; enabled: boolean; configurable: boolean }> }).capabilities || [];
  assert.equal(caps.find((row) => row.key === 'orders')?.enabled, true);
  assert.equal(caps.find((row) => row.key === 'orders')?.configurable, false);
  assert.equal(caps.find((row) => row.key === 'traceability')?.enabled, true);
  const clientView = await portal.getFlowConfiguration(customerA);
  assert.equal(clientView.features.orders, true);
  assert.equal(clientView.features.traceability, true);
});

test('admin can disable a capability and the client of that tenant no longer sees it', async () => {
  const before = await portal.getFlowConfiguration(customerA);
  assert.equal(before.features.download_3d, true);
  await flowCfg.putFlowConfiguration(adminA, {
    features: FLOW_FEATURE_KEYS.map((featureKey) => ({
      featureKey,
      enabled: featureKey !== 'download_3d',
    })),
    actionOrder: ['continue_production', 'preview', 'download_2d', 'download_3d'],
  });
  const after = await portal.getFlowConfiguration(customerA);
  assert.equal(after.features.download_3d, false);
  assert.equal(after.features.download_2d, true);
  assert.deepEqual(after.actionOrder, ['continue_production', 'preview', 'download_2d', 'download_3d']);
});

test('admin can change presentation order and the client sees the new order', async () => {
  const view = await portal.getFlowConfiguration(customerA);
  assert.equal(view.actionOrder[0], 'continue_production');
  assert.equal(view.actionOrder[1], 'preview');
});

test('flow configuration is tenant-isolated', async () => {
  const other = await portal.getFlowConfiguration(customerB);
  assert.equal(other.features.download_3d, true);
  assert.deepEqual(other.actionOrder[0], 'preview');
});

test('customer cannot change flow configuration', async () => {
  await assert.rejects(
    () =>
      flowCfg.putFlowConfiguration(customerA, {
        features: [{ featureKey: 'ojo', enabled: false }],
      }),
    (err: unknown) => err instanceof AccessDeniedError
  );
});

test('production gates stay mandatory regardless of flow configuration', () => {
  assert.throws(
    () =>
      assertCanGenerateOutputs({
        selectedGarmentTypes: ['CAMISETA'],
        previewApproved: false,
        rawMaterial: false,
        designFileId: 'design-1',
        productionRevisionId: 'rev-1',
        rosterStatus: 'APPROVED',
      }),
    (err: unknown) => err instanceof RequestInvalidError && String(err.message).includes('PREVIEW_PENDING')
  );
});

test('changing flow configuration is audited and does not rewrite order history', async () => {
  const catalog = new WorkshopCatalogService(kernel.store);
  await catalog.setCategory(adminA, 'SUBLIMACION', true);
  const created = await portal.createOrder(customerA, {
    workshopItemId: libraryItemId('bandera'),
    quantity: 1,
    projectName: 'Pedido Flujo',
  });
  const orderId = String(created.orderId || created.id);
  const before = await kernel.orders.getOrder(orderId, 'admin');
  const historyLen = (before?.history || []).length;
  await flowCfg.putFlowConfiguration(adminA, {
    features: [{ featureKey: 'messaging', enabled: false }],
  });
  const after = await kernel.orders.getOrder(orderId, 'admin');
  assert.equal((after?.history || []).length, historyLen);
  assert.equal(after?.status, before?.status);
  const audit = await kernel.store.listAudit(adminA.tenantId);
  const flowEvents = audit.filter((e) => e.action === 'FLOW_CONFIGURATION_UPDATED' && e.target === adminA.tenantId);
  assert.ok(flowEvents.length >= 1);
  assert.equal(flowEvents.every((e) => e.actorId === adminA.userId), true);
  const otherAudit = await kernel.store.listAudit(adminB.tenantId);
  assert.equal(otherAudit.filter((e) => e.action === 'FLOW_CONFIGURATION_UPDATED').length, 0);
});
