import type { AppSettings, ModelInfo, SystemInfo } from './entities';
import type { ImageType, OutputFormat } from './enums';

export interface OutputSizeConfig {
  mode: 'scale' | 'pixels' | 'physical';
  scale?: number;
  width?: number;
  height?: number;
  widthCm?: number;
  heightCm?: number;
  dpi?: number;
  unit?: 'cm' | 'm';
}

export interface ProcessingConfig {
  inputPath: string;
  inputFileName: string;
  model: string;
  scale: number;
  format: OutputFormat;
  outputDir: string;
  useGPU: boolean;
  imageType?: ImageType;
  tileSize?: number;
  denoise?: boolean;
  outputSize?: OutputSizeConfig;
  /** Original image dimensions from validation — used to resolve physical targets. */
  inputSize?: { width: number; height: number };
}

export interface AppBootstrapPayload {
  settings: AppSettings;
  systemInfo: SystemInfo | null;
  models: ModelInfo[];
}

export interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  width?: number;
  height?: number;
  format?: string;
  mode?: string;
}

/** Maps persisted settings to CLI options (UI uses `quality` for best tier). */
export function settingsToProcessingOptions(settings: AppSettings) {
  return {
    useGPU: settings.useGPU,
    tileSize: settings.tileSize,
    quality: settings.quality === 'quality' ? ('best' as const) : settings.quality,
  };
}
