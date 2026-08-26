import type { ImageType, JobOperation, OutputFormat } from './enums';
import type { OutputSizeConfig } from './ipc-payloads';
import type { OrchestrationJobStatus } from './processing-port';
import type { ServiceError } from './service-contract';

/** Durable job entity. URIs are opaque strings — not Windows paths. */
export interface PersistedJob {
  jobId: string;
  operation: JobOperation;
  status: OrchestrationJobStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  input: {
    reference: string;
    name: string;
  };
  output?: {
    uri: string;
  };
  parameters: {
    model: string;
    scale: number;
    format: OutputFormat;
  };
  options?: {
    outputDirectory?: string;
    useGpu?: boolean;
    imageType?: ImageType;
    outputSize?: OutputSizeConfig;
    inputWidth?: number;
    inputHeight?: number;
    outputWidth?: number;
    outputHeight?: number;
  };
  error?: ServiceError;
  recovery?: {
    from: OrchestrationJobStatus;
    to: OrchestrationJobStatus;
    at: number;
    reason: string;
  };
}

export class JobTransitionError extends Error {
  constructor(
    public readonly from: OrchestrationJobStatus,
    public readonly to: OrchestrationJobStatus
  ) {
    super(`Invalid job transition: ${from} → ${to}`);
    this.name = 'JobTransitionError';
  }
}

const ALLOWED: Record<OrchestrationJobStatus, OrchestrationJobStatus[]> = {
  queued: ['processing', 'cancelled'],
  processing: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionJob(
  from: OrchestrationJobStatus,
  to: OrchestrationJobStatus
): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export function assertJobTransition(
  from: OrchestrationJobStatus,
  to: OrchestrationJobStatus
): void {
  if (!canTransitionJob(from, to)) {
    throw new JobTransitionError(from, to);
  }
}

export function applyJobStatus(
  job: PersistedJob,
  next: OrchestrationJobStatus,
  now: number = Date.now()
): PersistedJob {
  assertJobTransition(job.status, next);
  if (job.status === next) {
    return { ...job, updatedAt: now };
  }
  const nextJob: PersistedJob = {
    ...job,
    status: next,
    updatedAt: now,
  };
  if (next === 'processing' && job.startedAt == null) {
    nextJob.startedAt = now;
  }
  if (next === 'completed' || next === 'failed' || next === 'cancelled') {
    nextJob.completedAt = now;
  }
  return nextJob;
}

export const INTERRUPTED_EXECUTOR_REASON =
  'Job interrupted: local executor is no longer running';

export function recoverInterruptedJob(job: PersistedJob, now: number = Date.now()): PersistedJob {
  if (job.status !== 'processing') return job;
  const failed = applyJobStatus(job, 'failed', now);
  return {
    ...failed,
    error: {
      code: 'INTERNAL_ERROR',
      message: INTERRUPTED_EXECUTOR_REASON,
    },
    recovery: {
      from: 'processing',
      to: 'failed',
      at: now,
      reason: INTERRUPTED_EXECUTOR_REASON,
    },
  };
}
