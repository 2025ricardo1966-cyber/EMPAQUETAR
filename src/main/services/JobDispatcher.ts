import type {
  DispatchAssignment,
  ExecutionTarget,
  ProductionJob,
  WorkerDescriptor,
} from '../../contracts/production-orchestration';

export interface ExecutionWorkerPort {
  readonly descriptor: WorkerDescriptor;
  /** Local adapter may produce bytes; cloud abstract never pretends to render. */
  accept(job: ProductionJob): Promise<{ accepted: boolean; note?: string }>;
}

export class JobDispatcher {
  constructor(private workers: ExecutionWorkerPort[]) {}

  listWorkers(): WorkerDescriptor[] {
    return this.workers.map((w) => w.descriptor);
  }

  pick(job: ProductionJob): ExecutionWorkerPort {
    const target: ExecutionTarget = job.executionTarget;
    const wanted = target === 'cloud' ? 'CLOUD' : 'LOCAL';
    const worker = this.workers.find(
      (w) => w.descriptor.type === wanted && w.descriptor.capabilities.includes(job.capability)
    ) || this.workers.find((w) => w.descriptor.type === wanted);
    if (!worker) {
      throw new Error(`NO_WORKER:${wanted}`);
    }
    return worker;
  }

  async dispatch(job: ProductionJob): Promise<DispatchAssignment> {
    const worker = this.pick(job);
    const accepted = await worker.accept(job);
    if (!accepted.accepted) throw new Error('WORKER_REJECTED');
    worker.descriptor.lastHeartbeat = Date.now();
    worker.descriptor.status = 'busy';
    return {
      jobId: job.jobId,
      workerId: worker.descriptor.workerId,
      workerKind: worker.descriptor.type,
      executionTarget: job.executionTarget,
      plane: 'execution',
      cloudProvisioned: worker.descriptor.implementation === 'cloud-abstract' ? false : true,
    };
  }
}

export class LocalExecutionWorker implements ExecutionWorkerPort {
  readonly descriptor: WorkerDescriptor = {
    workerId: 'worker-local-01',
    type: 'LOCAL',
    capabilities: ['image-processing', 'upscale', 'file-processing'],
    status: 'idle',
    lastHeartbeat: Date.now(),
    implementation: 'local-adapter',
  };

  async accept(_job: ProductionJob): Promise<{ accepted: boolean }> {
    this.descriptor.lastHeartbeat = Date.now();
    return { accepted: true };
  }
}

/**
 * Cloud execution port — not a production GPU. Jobs may be accepted onto the
 * abstract worker; completion must come from an explicit callback, never a fake render.
 */
export class CloudExecutionWorker implements ExecutionWorkerPort {
  readonly descriptor: WorkerDescriptor = {
    workerId: 'worker-cloud-abstract',
    type: 'CLOUD',
    capabilities: ['image-processing', 'upscale', 'heavy-processing'],
    status: 'idle',
    lastHeartbeat: Date.now(),
    implementation: 'cloud-abstract',
  };

  async accept(_job: ProductionJob): Promise<{ accepted: boolean; note?: string }> {
    this.descriptor.lastHeartbeat = Date.now();
    return { accepted: true, note: 'cloud-abstract:not_provisioned' };
  }
}
