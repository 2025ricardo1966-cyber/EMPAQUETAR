import type {
  ProcessInstance,
  ProductionArtifact,
  ProductionJob,
  WorkerDescriptor,
} from '../../contracts/production-orchestration';
import type { WorkflowDefinition, WorkflowInstance } from '../../contracts/workflow-domain';

/** Control-plane production persistence. Directory/OS paths must not leak into the model. */
export interface ProductionStore {
  saveProcess(row: ProcessInstance): Promise<void>;
  saveJob(row: ProductionJob): Promise<void>;
  saveArtifact(row: ProductionArtifact): Promise<void>;
  saveWorker(row: WorkerDescriptor): Promise<void>;
  listProcesses(orderId: string): Promise<ProcessInstance[]>;
  listProcessesByTenant(tenantId: string): Promise<ProcessInstance[]>;
  getProcess(instanceId: string): Promise<ProcessInstance | undefined>;
  listJobs(filter?: { orderId?: string; processInstanceId?: string; tenantId?: string }): Promise<ProductionJob[]>;
  getJob(jobId: string): Promise<ProductionJob | undefined>;
  listArtifacts(orderId: string): Promise<ProductionArtifact[]>;
  listWorkers(): Promise<WorkerDescriptor[]>;
  writeBlob(artifactId: string, bytes: Buffer): Promise<string>;
  readBlob?(fileId: string): Promise<Buffer | undefined>;
  saveWorkflowDefinition(row: WorkflowDefinition): Promise<void>;
  listWorkflowDefinitions(tenantId: string): Promise<WorkflowDefinition[]>;
  getWorkflowDefinition(workflowId: string): Promise<WorkflowDefinition | undefined>;
  saveWorkflowInstance(row: WorkflowInstance): Promise<void>;
  getWorkflowInstanceByOrder(orderId: string): Promise<WorkflowInstance | undefined>;
  listWorkflowInstances(tenantId: string): Promise<WorkflowInstance[]>;
}
