import http from 'http';
import { OrderService } from '../main/services/OrderService';
import { TenantControlService } from '../main/services/TenantControlService';
import { ProductionOrchestrator } from '../main/services/ProductionOrchestrator';
import { ProductionCenterService } from '../main/services/ProductionCenterService';
import { WorkflowEngine } from '../main/services/WorkflowEngine';
import { TraceService } from '../main/services/TraceService';
import { CustomerPortalService } from '../main/services/CustomerPortalService';
import { AdminService } from '../main/services/AdminService';
import { JobDispatcher, LocalExecutionWorker, CloudExecutionWorker } from '../main/services/JobDispatcher';
import { ControlPlaneStore } from './store/ControlPlaneStore';
import { openSqlEngine } from './db/engine';
import { applyMigrations } from './db/migrate';
import { loadControlPlaneEnv, type ControlPlaneEnv } from './env';
import { loadI18nCatalogs } from '../i18n';
import { ActivateAdminRepository, WorkshopAdminRepository } from './auth-helpers';
import { createControlPlaneServer } from './http';
import type { SqlEngine } from './db/engine';
import { EmailService } from '../main/services/email/EmailService';
import { EmailDispatcher } from '../main/services/email/EmailDispatcher';
import { ResendTransport } from '../main/services/email/ResendTransport';
import { OnlinePaymentService } from '../main/services/payments/OnlinePaymentService';
import { SuperAdminPlatformService } from '../main/services/SuperAdminPlatformService';
import { ClientPortalService } from '../main/services/ClientPortalService';
import { FulfillmentService } from '../main/services/FulfillmentService';
import { SecurityLayer } from '../main/services/SecurityLayer';
import { createWhatsAppProvider } from '../main/services/whatsapp/WhatsAppChannel';

export interface ControlPlaneKernel {
  env: ControlPlaneEnv;
  db: SqlEngine;
  store: ControlPlaneStore;
  orders: OrderService;
  control: TenantControlService;
  orchestrator: ProductionOrchestrator;
  center: ProductionCenterService;
  workflows: WorkflowEngine;
  workshopAdmin: AdminService;
  activateAdmin: AdminService;
  portal: CustomerPortalService;
  tracer: TraceService;
  emailService: EmailService;
  payments: OnlinePaymentService;
  platform: SuperAdminPlatformService;
  fulfillment: FulfillmentService;
  security: SecurityLayer;
  admins: Map<string, AdminService>;
  server?: http.Server;
  url?: string;
}

export async function bootControlPlane(options?: {
  env?: ControlPlaneEnv;
  listen?: boolean;
  databaseUrl?: string;
}): Promise<ControlPlaneKernel> {
  const env = options?.env || loadControlPlaneEnv();
  loadI18nCatalogs();
  const db = await openSqlEngine(options?.databaseUrl ?? env.databaseUrl);
  await applyMigrations(db);
  if (env.objectStoreProvider === 's3') {
    console.warn(
      'MASCAYL_OBJECT_STORE s3/r2 is prepared, not executed. Blobs stay on sql/filesystem with opaque cloud:// URIs. No fake object-storage vendor.'
    );
  }
  const store = new ControlPlaneStore(db, env.blobDir);
  const orders = new OrderService(store);
  const workshopRepo = new WorkshopAdminRepository(store);
  const control = new TenantControlService(store, orders, workshopRepo);
  const workshopAdmin = new AdminService(workshopRepo, orders, control);
  const activateAdmin = new AdminService(new ActivateAdminRepository(store), orders, control);
  const dispatcher = new JobDispatcher([new LocalExecutionWorker(), new CloudExecutionWorker()]);
  const orchestrator = new ProductionOrchestrator(store, orders, dispatcher, workshopRepo);
  const workflows = new WorkflowEngine(store, orders, workshopRepo, orchestrator);
  orchestrator.setWorkflows(workflows);
  const center = new ProductionCenterService(orders, orchestrator, store, workshopRepo);
  center.setWorkflows(workflows);
  const portal = new CustomerPortalService(workshopAdmin, workshopRepo, orders, store);
  portal.setOrchestrator(orchestrator);
  portal.setWorkflows(workflows);
  const tracer = new TraceService(store, orders);
  const emailTransport = env.resendApiKey ? new ResendTransport(env.resendApiKey) : null;
  if (!env.resendApiKey) {
    console.warn('RESEND_API_KEY missing — transactional email disabled until a transport is configured');
  }
  const emailService = new EmailService(store, emailTransport, env.emailFromDefault);
  const emailDispatcher = new EmailDispatcher(store, emailService, {
    from: env.emailFromDefault,
    appUrl: env.emailAppUrl || '',
  });
  tracer.setAfterRecord(async (event) => {
    await emailDispatcher.onEvent(event);
  });
  orders.setLifecycleHook(async ({ type, order }) => {
    await tracer.onOrderLifecycle(type, order);
  });
  workflows.setTracer(tracer);
  orchestrator.setTracer(tracer);
  portal.setTracer(tracer);
  workshopAdmin.setTracer(tracer);
  activateAdmin.setTracer(tracer);
  center.setTracer(tracer);
  control.setTracer(tracer);
  const clientPortal = new ClientPortalService(store, orders, portal, workshopAdmin, tracer, workflows, orchestrator);
  const payments = new OnlinePaymentService(store, clientPortal, orders, tracer, env);
  const platform = new SuperAdminPlatformService(store, orders, tracer);
  const fulfillment = new FulfillmentService(workshopAdmin, orders, tracer, store);
  const security = new SecurityLayer(
    store,
    tracer,
    emailService,
    createWhatsAppProvider({
      WHATSAPP_PROVIDER: env.whatsappProvider,
      TWILIO_ACCOUNT_SID: env.twilioAccountSid,
      TWILIO_AUTH_TOKEN: env.twilioAuthToken,
      TWILIO_WHATSAPP_FROM: env.twilioWhatsappFrom,
    }),
    env
  );
  await security.load();
  const kernel: ControlPlaneKernel = {
    env,
    db,
    store,
    orders,
    control,
    orchestrator,
    center,
    workflows,
    workshopAdmin,
    activateAdmin,
    portal,
    tracer,
    emailService,
    payments,
    platform,
    fulfillment,
    security,
    admins: new Map(),
  };
  if (options?.listen !== false) {
    const server = createControlPlaneServer(kernel);
    await new Promise<void>((resolve, reject) => {
      server.listen(env.port, env.host, () => resolve());
      server.on('error', reject);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : env.port;
    kernel.server = server;
    kernel.url = `http://${env.host}:${port}`;
    emailDispatcher.setAppUrl(kernel.url);
  }
  return kernel;
}

export async function stopControlPlane(kernel: ControlPlaneKernel): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!kernel.server) return resolve();
    kernel.server.close(() => resolve());
  });
  kernel.emailService.stop();
  await kernel.db.close();
}
