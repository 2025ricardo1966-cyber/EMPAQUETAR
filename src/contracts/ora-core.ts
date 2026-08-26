import { RequestInvalidError } from './configuration-schema';

/** Capacidades core ORA. EMPAQUETAR es un vertical, no el dueño de estas capacidades. */
export const ORA_CAPABILITIES = [
  'EMPAQUETAR',
  'IMAGE_16K',
  'TPU',
  'CDR_PDF',
  'FLAGS',
  'PATTERN_LIBRARY',
  'CANDY_BAR',
  'LUGGAGE_COVER',
  'BATCH_DESIGN',
  'FILE_CONVERSION',
  'DTF',
  'DTF_UV',
  'DOCUMENT_INTELLIGENCE',
  'PRODUCTION_PACK',
] as const;

export type OraCapabilityId = (typeof ORA_CAPABILITIES)[number];

export type OraConsumerKind = 'WORKSHOP_USER' | 'CAPABILITY_USER';
export type OraCommercialContext = 'WORKSHOP_LINKED' | 'INDEPENDENT';

export type OraJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type OraFitness = 'APTO' | 'APTO_CON_ADVERTENCIA' | 'NO_APTO';

export type OraPatternValidation = 'INDUSTRIAL_CATALOG' | 'INFERENCE_UNVALIDATED';

export interface OraIdentity {
  tenantId: string;
  actorId: string;
  consumerKind: OraConsumerKind;
}

export interface OraCommercialHook {
  context: OraCommercialContext;
  tariffCode?: string;
  usage: {
    capability: OraCapabilityId;
    bytesIn: number;
    bytesOut: number;
    durationMs: number;
    operation?: string;
    formatOrigin?: string;
    formatDestination?: string;
    resolution?: string;
    inputBytes?: number;
    outputBytes?: number;
    processingDuration?: number;
  };
}

export interface OraFileRef {
  fileId: string;
  role: 'ORIGINAL' | 'DERIVED' | 'PRODUCTION' | 'PRINT' | 'VECTOR' | 'REPORT';
  filename: string;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
}

export interface OraCapabilityJob {
  jobId: string;
  tenantId: string;
  actorId: string;
  capability: OraCapabilityId;
  status: OraJobStatus;
  identity: OraIdentity;
  commercial: OraCommercialHook;
  original?: OraFileRef;
  derived: OraFileRef[];
  warnings: string[];
  result?: Record<string, unknown>;
  orderId?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export const IMAGE_16K_PIPELINE = ['intake', 'prepare', 'process_16k', 'validate', 'output'] as const;
export type Image16kStage = (typeof IMAGE_16K_PIPELINE)[number];

export function parseCommercialContext(raw: unknown): OraCommercialContext {
  const v = String(raw || 'INDEPENDENT').toUpperCase();
  if (v === 'WORKSHOP_LINKED' || v === 'INDEPENDENT') return v;
  throw new RequestInvalidError('ORA_COMMERCIAL_CONTEXT');
}

export function parseConsumerKind(roleId: string): OraConsumerKind {
  if (roleId === 'CUSTOMER') return 'CAPABILITY_USER';
  return 'WORKSHOP_USER';
}

export function oraCapabilityCatalog() {
  return [
    {
      id: 'EMPAQUETAR' as const,
      independent: false,
      workshop: true,
      customer: true,
      capabilityUser: false,
      note: 'Vertical taller. No es una capacidad arrancable.',
    },
    {
      id: 'IMAGE_16K' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Pipeline preparado; procesamiento no ejecutado en este ciclo.',
    },
    {
      id: 'TPU' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Límites en TPUAdminConfig; no encapsular en Order.',
    },
    {
      id: 'CDR_PDF' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Original CDR + PDF derivado. Conversión no equivalente.',
    },
    {
      id: 'FLAGS' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Ancho × alto libres. No usa familias de prenda.',
    },
    {
      id: 'PATTERN_LIBRARY' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Biblioteca real de Apparel Studio. Inferencia no es molde validado.',
    },
    {
      id: 'CANDY_BAR' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Composición por medidas del cliente, no por prenda.',
    },
    {
      id: 'LUGGAGE_COVER' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Cubre maletas + variante Carry-On. Cuatro vistas del mismo objeto.',
    },
    {
      id: 'BATCH_DESIGN' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: '1 diseño → N unidades. maxUnitsPerOrder=100 no aplica fuera del alta EMPAQUETAR.',
    },
    {
      id: 'FILE_CONVERSION' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Análisis + conversión + vectorización etiquetada + escalado. Original inmutable.',
    },
    {
      id: 'DTF' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Preparación DTF textil. Reutiliza preflight + transparencia PNG + etapas dtf existentes. Original inmutable.',
    },
    {
      id: 'DTF_UV' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Preparación DTF UV. Mismo motor DTF; capa blanca/barniz UV no se fingen. Original inmutable.',
    },
    {
      id: 'DOCUMENT_INTELLIGENCE' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'PDF digital → texto estructurado. Raster/escaneado: OCR no presente, REQUIERE REVISIÓN. Original inmutable.',
    },
    {
      id: 'PRODUCTION_PACK' as const,
      independent: true,
      workshop: true,
      customer: true,
      capabilityUser: true,
      note: 'Paquete ORIGINAL/DERIVADOS/PRINT/VECTOR/PRODUCTION/REPORT sobre jobs y blobs existentes.',
    },
  ];
}

export function prepare16kPipeline(input: { filename?: string; widthPx?: number; heightPx?: number }) {
  return {
    capability: 'IMAGE_16K' as const,
    status: 'PREPARED_NOT_EXECUTED' as const,
    stages: IMAGE_16K_PIPELINE.map((stage) => ({
      stage,
      ready: stage === 'intake' || stage === 'prepare',
      executed: false,
    })),
    target: { widthPx: 15360, heightPx: 8640, label: '16K' },
    input: {
      filename: input.filename,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
    },
    consumers: ['fotografo', 'disenador', 'impresor', 'particular', 'taller', 'otros_ora'],
    note: 'El procesamiento 16K no se ejecuta en este ciclo. El contrato es cloud-safe (URIs opacas, sin rutas locales).',
  };
}
