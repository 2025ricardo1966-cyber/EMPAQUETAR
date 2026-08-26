import fs from 'fs/promises';
import path from 'path';
import type {
  ProcessInstance,
  ProductionArtifact,
  ProductionJob,
  WorkerDescriptor,
} from '../../contracts/production-orchestration';
import type { ProductionStore } from './ProductionStore';

import type { WorkflowDefinition, WorkflowInstance } from '../../contracts/workflow-domain';

interface State {
  processes: ProcessInstance[];
  jobs: ProductionJob[];
  artifacts: ProductionArtifact[];
  workers: WorkerDescriptor[];
  workflows: WorkflowDefinition[];
  workflowInstances: WorkflowInstance[];
}

/** Durable production store. Directory injected by host — no Windows paths in the model. */
export class JsonFileProductionStore implements ProductionStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private directory: string) {}

  setDirectory(directory: string): void {
    this.directory = directory;
  }

  async saveProcess(row: ProcessInstance): Promise<void> {
    await this.mutate((s) => upsert(s.processes, row, (x) => x.instanceId === row.instanceId));
  }

  async saveJob(row: ProductionJob): Promise<void> {
    await this.mutate((s) => upsert(s.jobs, row, (x) => x.jobId === row.jobId));
  }

  async saveArtifact(row: ProductionArtifact): Promise<void> {
    await this.mutate((s) => upsert(s.artifacts, row, (x) => x.artifactId === row.artifactId));
  }

  async saveWorker(row: WorkerDescriptor): Promise<void> {
    await this.mutate((s) => upsert(s.workers, row, (x) => x.workerId === row.workerId));
  }

  async listProcesses(orderId: string): Promise<ProcessInstance[]> {
    const s = await this.read();
    return s.processes.filter((p) => p.orderId === orderId).sort((a, b) => a.order - b.order);
  }

  async listProcessesByTenant(tenantId: string): Promise<ProcessInstance[]> {
    return (await this.read()).processes.filter((p) => p.tenantId === tenantId);
  }

  async getProcess(instanceId: string): Promise<ProcessInstance | undefined> {
    return (await this.read()).processes.find((p) => p.instanceId === instanceId);
  }

  async listJobs(filter: { orderId?: string; processInstanceId?: string; tenantId?: string } = {}): Promise<ProductionJob[]> {
    const s = await this.read();
    return s.jobs.filter((j) => {
      if (filter.orderId && j.orderId !== filter.orderId) return false;
      if (filter.processInstanceId && j.processInstanceId !== filter.processInstanceId) return false;
      if (filter.tenantId && j.tenantId !== filter.tenantId) return false;
      return true;
    });
  }

  async getJob(jobId: string): Promise<ProductionJob | undefined> {
    return (await this.read()).jobs.find((j) => j.jobId === jobId);
  }

  async listArtifacts(orderId: string): Promise<ProductionArtifact[]> {
    return (await this.read()).artifacts.filter((a) => a.orderId === orderId);
  }

  async listWorkers(): Promise<WorkerDescriptor[]> {
    return (await this.read()).workers;
  }

  async writeBlob(artifactId: string, bytes: Buffer): Promise<string> {
    await this.ensureDir();
    const dir = path.join(this.directory, 'blobs');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${artifactId}.bin`), bytes);
    return `artifacts/${artifactId}`;
  }

  async readBlob(fileId: string): Promise<Buffer | undefined> {
    try {
      return await fs.readFile(path.join(this.directory, 'blobs', `${fileId}.bin`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async saveWorkflowDefinition(row: WorkflowDefinition): Promise<void> {
    await this.mutate((s) => upsert(s.workflows, row, (x) => x.id === row.id));
  }

  async listWorkflowDefinitions(tenantId: string): Promise<WorkflowDefinition[]> {
    return (await this.read()).workflows.filter((w) => w.tenantId === tenantId);
  }

  async getWorkflowDefinition(workflowId: string): Promise<WorkflowDefinition | undefined> {
    return (await this.read()).workflows.find((w) => w.id === workflowId);
  }

  async saveWorkflowInstance(row: WorkflowInstance): Promise<void> {
    await this.mutate((s) => upsert(s.workflowInstances, row, (x) => x.instanceId === row.instanceId));
  }

  async getWorkflowInstanceByOrder(orderId: string): Promise<WorkflowInstance | undefined> {
    return (await this.read()).workflowInstances.find((w) => w.orderId === orderId);
  }

  async listWorkflowInstances(tenantId: string): Promise<WorkflowInstance[]> {
    return (await this.read()).workflowInstances.filter((w) => w.tenantId === tenantId);
  }

  private async read(): Promise<State> {
    try {
      const raw = await fs.readFile(this.statePath(), 'utf8');
      const parsed = JSON.parse(raw) as State;
      return {
        processes: parsed.processes || [],
        jobs: parsed.jobs || [],
        artifacts: parsed.artifacts || [],
        workers: parsed.workers || [],
        workflows: parsed.workflows || [],
        workflowInstances: parsed.workflowInstances || [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { processes: [], jobs: [], artifacts: [], workers: [], workflows: [], workflowInstances: [] };
      }
      throw error;
    }
  }

  private async mutate(work: (state: State) => void): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureDir();
      const state = await this.read();
      work(state);
      const target = this.statePath();
      const temp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await fs.rename(temp, target);
    });
  }

  private statePath(): string {
    return path.join(this.directory, 'state.json');
  }

  private async ensureDir(): Promise<void> {
    if (!this.directory) return;
    await fs.mkdir(this.directory, { recursive: true });
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.writeChain.then(work, work);
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

function upsert<T>(list: T[], row: T, match: (item: T) => boolean): void {
  const idx = list.findIndex(match);
  if (idx >= 0) list[idx] = row;
  else list.push(row);
}
