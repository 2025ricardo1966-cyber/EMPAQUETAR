import type { ImageType, JobOperation, OutputFormat } from './enums';
import type { OutputSizeConfig, ProcessingConfig, IPCResponse } from './ipc-payloads';
import type { OrchestrationJobStatus } from './processing-port';

/** Public error codes — same set for Windows / macOS / web / cloud. */
export type ServiceErrorCode =
  | 'INVALID_REQUEST'
  | 'JOB_NOT_FOUND'
  | 'PROCESSING_ERROR'
  | 'CANCELLED'
  | 'INTERNAL_ERROR'
  | 'INVALID_TRANSITION';

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServiceError };

/** Opaque input. Clients pass a string reference; they do not select an executor. */
export interface JobInputRef {
  reference: string;
  name: string;
}

export interface CreateJobRequest {
  operation: JobOperation;
  input: JobInputRef;
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
  };
}

export interface CreateJobResponse {
  jobId: string;
  status: 'queued';
  operation: JobOperation;
  createdAt: number;
}

export interface JobSnapshot {
  jobId: string;
  operation: JobOperation;
  status: OrchestrationJobStatus;
  progress: number;
  createdAt: number;
  updatedAt?: number;
  startedAt?: number;
  completedAt?: number;
  endedAt?: number;
}

export interface JobOutputRef {
  uri: string;
}

export interface JobResult {
  jobId: string;
  status: OrchestrationJobStatus;
  output?: JobOutputRef;
  metadata: {
    operation: JobOperation;
    progress: number;
    queuedAt?: number;
    startedAt?: number;
    endedAt?: number;
    processingTimeMs?: number;
    inputWidth?: number;
    inputHeight?: number;
    outputWidth?: number;
    outputHeight?: number;
    engine?: string;
    location?: string;
  };
  error?: ServiceError;
}

/** Portable job API. Transport (IPC / HTTP) is a client adapter concern. */
export interface MascaylJobApi {
  createJob(request: CreateJobRequest): Promise<ServiceResult<CreateJobResponse>>;
  getJob(jobId: string): Promise<ServiceResult<JobSnapshot>>;
  getJobStatus(jobId: string): Promise<ServiceResult<JobSnapshot>>;
  getJobResult(jobId: string): Promise<ServiceResult<JobResult>>;
  listJobs(): Promise<ServiceResult<JobSnapshot[]>>;
  cancelJob(jobId: string): Promise<ServiceResult<JobSnapshot>>;
}

const OUTPUT_FORMATS: OutputFormat[] = ['png', 'jpg', 'webp'];

export function serviceFail(code: ServiceErrorCode, message: string): ServiceResult<never> {
  return { ok: false, error: { code, message } };
}

export function serviceOk<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function isCreateJobRequest(value: unknown): value is CreateJobRequest {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.input !== undefined &&
    rec.parameters !== undefined &&
    rec.operation !== undefined &&
    !('inputPath' in rec)
  );
}

export function validateCreateJobRequest(request: unknown): ServiceError | null {
  if (!request || typeof request !== 'object') {
    return { code: 'INVALID_REQUEST', message: 'CreateJobRequest is required' };
  }
  const req = request as Partial<CreateJobRequest>;
  if (req.operation !== 'upscale') {
    return { code: 'INVALID_REQUEST', message: 'operation must be upscale' };
  }
  const reference = req.input?.reference?.trim();
  const name = req.input?.name?.trim();
  if (!reference) {
    return { code: 'INVALID_REQUEST', message: 'input.reference is required' };
  }
  if (!name) {
    return { code: 'INVALID_REQUEST', message: 'input.name is required' };
  }
  const model = req.parameters?.model?.trim();
  if (!model) {
    return { code: 'INVALID_REQUEST', message: 'parameters.model is required' };
  }
  const scale = req.parameters?.scale;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
    return { code: 'INVALID_REQUEST', message: 'parameters.scale must be a positive number' };
  }
  const format = req.parameters?.format;
  if (!format || !OUTPUT_FORMATS.includes(format)) {
    return { code: 'INVALID_REQUEST', message: 'parameters.format must be png, jpg, or webp' };
  }
  const outputDirectory = req.options?.outputDirectory?.trim();
  if (!outputDirectory) {
    return { code: 'INVALID_REQUEST', message: 'options.outputDirectory is required' };
  }
  return null;
}

export function processingConfigToCreateJobRequest(config: ProcessingConfig): CreateJobRequest {
  return {
    operation: 'upscale',
    input: {
      reference: config.inputPath,
      name: config.inputFileName,
    },
    parameters: {
      model: config.model,
      scale: config.scale,
      format: config.format,
    },
    options: {
      outputDirectory: config.outputDir,
      useGpu: config.useGPU,
      imageType: config.imageType,
      outputSize: config.outputSize,
      inputWidth: config.inputSize?.width,
      inputHeight: config.inputSize?.height,
    },
  };
}

export function createJobRequestToProcessingConfig(request: CreateJobRequest): ProcessingConfig {
  const width = request.options?.inputWidth;
  const height = request.options?.inputHeight;
  return {
    inputPath: request.input.reference,
    inputFileName: request.input.name,
    model: request.parameters.model,
    scale: request.parameters.scale,
    format: request.parameters.format,
    outputDir: request.options?.outputDirectory ?? '',
    useGPU: request.options?.useGpu ?? false,
    imageType: request.options?.imageType,
    outputSize: request.options?.outputSize,
    inputSize:
      width != null && height != null ? { width, height } : undefined,
  };
}

export function jobResultError(
  status: OrchestrationJobStatus,
  message?: string
): ServiceError | undefined {
  if (status === 'failed') {
    return { code: 'PROCESSING_ERROR', message: message || 'Processing failed' };
  }
  if (status === 'cancelled') {
    return { code: 'CANCELLED', message: message || 'Job cancelled' };
  }
  return undefined;
}

export function serviceResultToIpc<T>(result: ServiceResult<T>): IPCResponse<T> {
  if (result.ok) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message, code: result.error.code };
}
