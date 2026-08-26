import type {
  AppThemeId,
  ImageType,
  JobOperation,
  JobStatus,
  ModelType,
  OutputFormat,
  ProcessingQuality,
} from './enums';
import type { OutputSizeConfig } from './ipc-payloads';

export interface ImageSize {
  width: number;
  height: number;
}

export interface ProcessingJob {
  id: string;
  operation?: JobOperation;
  inputPath: string;
  inputFileName: string;
  outputPath: string;
  modelName: string;
  scale: number;
  format: OutputFormat;
  status: JobStatus;
  progress: number;
  imageType?: ImageType;
  queuedAt?: number;
  startTime?: number;
  endTime?: number;
  error?: string;
  inputSize?: ImageSize;
  outputSize?: ImageSize;
  processingTime?: number;
  targetOutputSize?: OutputSizeConfig;
}

export interface ModelInfo {
  name: string;
  displayName: string;
  description: string;
  scales: number[];
  type: ModelType;
  available: boolean;
  path?: string;
}

export interface SystemInfo {
  hasGPU: boolean;
  gpuName?: string;
  hasCUDA: boolean;
  vramGB?: number;
  cpuCores: number;
  totalRAM: number;
  pythonVersion?: string;
  torchVersion?: string;
  /** Compile-time CUDA tag on this wheel; not a run capability. */
  torchCudaCompiled?: string | null;
  inferenceDevice?: 'cpu' | 'cuda';
  backend?: string;
}

export interface ProcessingStats {
  totalProcessed: number;
  totalFailed: number;
  averageTime: number;
  totalSize: number;
}

export interface ModelDownloadProgress {
  percent: number;
  mbDownloaded: number;
  mbTotal: number;
  speedMBps?: number;
}

export interface AppSettings {
  outputDirectory: string;
  defaultModel: string;
  defaultScale: number;
  defaultFormat: OutputFormat;
  useGPU: boolean;
  tileSize: number;
  autoSave: boolean;
  showNotifications: boolean;
  theme: AppThemeId;
  quality: 'fast' | 'balanced' | 'quality';
  outputSize?: OutputSizeConfig;
}

export interface ProcessingOptions {
  useGPU: boolean;
  tileSize: number;
  quality: ProcessingQuality;
  outputSize?: OutputSizeConfig;
}
