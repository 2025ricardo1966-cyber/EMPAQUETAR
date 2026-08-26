export type ImageType =
  | 'portrait_skin'
  | 'product_object'
  | 'illustration_anime'
  | 'landscape_natural'
  | 'text_document';

export type JobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobOperation = 'upscale';

export type OutputFormat = 'png' | 'jpg' | 'webp';

export type ModelType = 'esrgan' | 'real-esrgan' | 'waifu2x' | 'custom';

export type AppThemeId = 'cyberpunk-hud' | 'carbon-pro' | 'warm-studio';

export type ProcessingQuality = 'fast' | 'balanced' | 'best';
