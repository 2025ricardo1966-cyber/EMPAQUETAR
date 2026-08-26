import type { JobStatus, JobOperation } from './enums';
import type { ProcessingOptions } from './entities';

/** Public job states for any client (Windows / future macOS / web / cloud). */
export type OrchestrationJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ProcessingExecutorLocation = 'local' | 'remote';

export class ExecutorJobError extends Error {
  constructor(
    public readonly code: 'cancelled' | 'timeout' | 'engine' | 'unknown',
    message: string
  ) {
    super(message);
    this.name = 'ExecutorJobError';
  }
}

export interface JobStatusView {
  jobId: string;
  operation: JobOperation;
  status: OrchestrationJobStatus;
  progress: number;
  error?: string;
}

export interface JobResultView {
  jobId: string;
  operation: JobOperation;
  status: OrchestrationJobStatus;
  outputPath?: string;
  error?: string;
  inputSize?: { width: number; height: number };
  outputSize?: { width: number; height: number };
  processingTime?: number;
  queuedAt?: number;
  startedAt?: number;
  endedAt?: number;
  metadata?: {
    engine?: string;
    location?: ProcessingExecutorLocation;
  };
}

export interface ProcessingWorkRequest {
  jobId: string;
  operation: JobOperation;
  inputPath: string;
  outputPath: string;
  modelName: string;
  scale: number;
  format: string;
  options: ProcessingOptions;
}

export interface ProcessingWorkResult {
  success: boolean;
  input_size?: { width: number; height: number } | [number, number];
  output_size?: { width: number; height: number } | [number, number];
  error?: string;
}

/**
 * OS-agnostic processing worker. Production injects LocalRealesrganExecutor.
 * A cloud GPU worker would implement the same methods; the client stays unchanged.
 */
export interface ProcessingExecutor {
  readonly location: ProcessingExecutorLocation;
  readonly engine: string;
  execute(
    work: ProcessingWorkRequest,
    onProgress?: (progress: number) => void
  ): Promise<ProcessingWorkResult>;
  cancel(jobId: string): boolean;
}

export function toOrchestrationStatus(status: JobStatus): OrchestrationJobStatus {
  if (status === 'pending') return 'queued';
  return status;
}
