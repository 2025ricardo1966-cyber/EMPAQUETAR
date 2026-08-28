/**
 * Single catalog of EMPAQUETAR workshop capabilities that this version actually supports.
 *
 * New client-flow capability:
 *   1. implement it in the product
 *   2. register it here with supported: true
 *   3. it appears in the workshop configuration panel
 *
 * This is presentation/offering configuration only.
 * It does not grant production authorization, alter FSM, gates, or order history.
 *
 * ORA independent capabilities stay in oraCapabilityCatalog() / GET /ora/capabilities.
 * They are not client-flow buttons and must not be duplicated here.
 */

export const EMPAQUETAR_CAPABILITY_CATEGORIES = [
  'core',
  'visual',
  'samples',
  'production',
  'commercial',
  'communication',
] as const;

export type EmpaquetarCapabilityCategory = (typeof EMPAQUETAR_CAPABILITY_CATEGORIES)[number];

/** Reserved for a future commercial plan. Not enforced. No paywall. */
export const EMPAQUETAR_COMMERCIAL_TIERS = ['BASIC', 'INTERMEDIATE', 'ENTERPRISE'] as const;
export type EmpaquetarCommercialTier = (typeof EMPAQUETAR_COMMERCIAL_TIERS)[number];

export const EMPAQUETAR_CAPABILITY_KEYS = [
  'orders',
  'traceability',
  'ojo',
  'ojo_zone',
  'ojo_rect',
  'ojo_ellipse',
  'ojo_hint',
  'ojo_scale',
  'preview',
  'preview_3d',
  'download_2d',
  'download_3d',
  'continue_production',
  'excel_upload',
  'client_approval',
  'consumption',
  'materials',
  'messaging',
] as const;

export type EmpaquetarCapabilityKey = (typeof EMPAQUETAR_CAPABILITY_KEYS)[number];

export const EMPAQUETAR_ACTION_KEYS = ['preview', 'download_2d', 'download_3d', 'continue_production'] as const;
export type EmpaquetarActionKey = (typeof EMPAQUETAR_ACTION_KEYS)[number];

export interface EmpaquetarCapabilityDefinition {
  key: EmpaquetarCapabilityKey;
  label: string;
  category: EmpaquetarCapabilityCategory;
  /** Only catalogued capabilities are supported in this version. */
  supported: true;
  availability: 'supported';
  /** false = nucleus: visible in the catalog, cannot be turned off. */
  configurable: boolean;
  /** Presentation dependencies. Never business authorization. */
  requires?: EmpaquetarCapabilityKey[];
  /** Runtime UI predicates. Never business authorization. */
  runtime?: {
    requiresPreview3dValid?: boolean;
  };
  actionKey?: EmpaquetarActionKey;
  defaultActionOrder?: number;
  /**
   * Future commercial classification. Null means not priced and not gated.
   * Do not read these fields to authorize production or hide paywalled features.
   */
  commercialTier: EmpaquetarCommercialTier | null;
  commercialPrice: number | null;
  commercialCategory: EmpaquetarCapabilityCategory;
}

const COMMERCIAL_UNSET = {
  commercialTier: null,
  commercialPrice: null,
} as const;

export const EMPAQUETAR_CAPABILITY_CATALOG: readonly EmpaquetarCapabilityDefinition[] = [
  {
    key: 'orders',
    label: 'Pedidos',
    category: 'core',
    supported: true,
    availability: 'supported',
    configurable: false,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'core',
  },
  {
    key: 'traceability',
    label: 'Trazabilidad',
    category: 'core',
    supported: true,
    availability: 'supported',
    configurable: false,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'core',
  },
  {
    key: 'ojo',
    label: 'OJO — interpretación visual',
    category: 'visual',
    supported: true,
    availability: 'supported',
    configurable: true,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'visual',
  },
  {
    key: 'ojo_zone',
    label: 'Selección de zona',
    category: 'visual',
    supported: true,
    availability: 'supported',
    configurable: true,
    requires: ['ojo'],
    ...COMMERCIAL_UNSET,
    commercialCategory: 'visual',
  },
  {
    key: 'ojo_rect',
    label: 'Marco rectangular',
    category: 'visual',
    supported: true,
    availability: 'supported',
    configurable: true,
    requires: ['ojo', 'ojo_zone'],
    ...COMMERCIAL_UNSET,
    commercialCategory: 'visual',
  },
  {
    key: 'ojo_ellipse',
    label: 'Marco elíptico',
    category: 'visual',
    supported: true,
    availability: 'supported',
    configurable: true,
    requires: ['ojo', 'ojo_zone'],
    ...COMMERCIAL_UNSET,
    commercialCategory: 'visual',
  },
  {
    key: 'ojo_hint',
    label: 'Solicitud de pista cuando existe ambigüedad',
    category: 'visual',
    supported: true,
    availability: 'supported',
    configurable: true,
    requires: ['ojo'],
    ...COMMERCIAL_UNSET,
    commercialCategory: 'visual',
  },
  {
    key: 'ojo_scale',
    label: 'Escalado/preparación automática',
    category: 'visual',
    supported: true,
    availability: 'supported',
    configurable: true,
    requires: ['ojo'],
    ...COMMERCIAL_UNSET,
    commercialCategory: 'visual',
  },
  {
    key: 'preview',
    label: 'Previsualización',
    category: 'samples',
    supported: true,
    availability: 'supported',
    configurable: true,
    actionKey: 'preview',
    defaultActionOrder: 1,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'samples',
  },
  {
    key: 'preview_3d',
    label: 'Previsualización 3D',
    category: 'samples',
    supported: true,
    availability: 'supported',
    configurable: true,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'samples',
  },
  {
    key: 'download_2d',
    label: 'Descarga de muestra 2D',
    category: 'samples',
    supported: true,
    availability: 'supported',
    configurable: true,
    actionKey: 'download_2d',
    defaultActionOrder: 2,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'samples',
  },
  {
    key: 'download_3d',
    label: 'Descarga de muestra 3D',
    category: 'samples',
    supported: true,
    availability: 'supported',
    configurable: true,
    requires: ['preview_3d'],
    runtime: { requiresPreview3dValid: true },
    actionKey: 'download_3d',
    defaultActionOrder: 3,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'samples',
  },
  {
    key: 'continue_production',
    label: 'Continuar a producción',
    category: 'production',
    supported: true,
    availability: 'supported',
    configurable: true,
    actionKey: 'continue_production',
    defaultActionOrder: 4,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'production',
  },
  {
    key: 'excel_upload',
    label: 'Carga de Excel',
    category: 'production',
    supported: true,
    availability: 'supported',
    configurable: true,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'production',
  },
  {
    key: 'client_approval',
    label: 'Solicitud de aprobación del cliente',
    category: 'production',
    supported: true,
    availability: 'supported',
    configurable: true,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'production',
  },
  {
    key: 'consumption',
    label: 'Información de consumo',
    category: 'commercial',
    supported: true,
    availability: 'supported',
    configurable: true,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'commercial',
  },
  {
    key: 'materials',
    label: 'Información de materia prima',
    category: 'commercial',
    supported: true,
    availability: 'supported',
    configurable: true,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'commercial',
  },
  {
    key: 'messaging',
    label: 'Mensajería cliente/taller',
    category: 'communication',
    supported: true,
    availability: 'supported',
    configurable: true,
    ...COMMERCIAL_UNSET,
    commercialCategory: 'communication',
  },
];

const BY_KEY = new Map(EMPAQUETAR_CAPABILITY_CATALOG.map((row) => [row.key, row]));

export function isEmpaquetarCapabilityKey(raw: string): raw is EmpaquetarCapabilityKey {
  return BY_KEY.has(raw as EmpaquetarCapabilityKey);
}

export function isEmpaquetarActionKey(raw: string): raw is EmpaquetarActionKey {
  return (EMPAQUETAR_ACTION_KEYS as readonly string[]).includes(raw);
}

/** Capabilities this version actually supports. Unsupported keys are not catalogued. */
export function discoverWorkshopCapabilities(): EmpaquetarCapabilityDefinition[] {
  return EMPAQUETAR_CAPABILITY_CATALOG.filter((row) => row.supported);
}

export function workshopCapabilityDefinition(key: string): EmpaquetarCapabilityDefinition | undefined {
  if (!isEmpaquetarCapabilityKey(key)) return undefined;
  const row = BY_KEY.get(key);
  return row?.supported ? row : undefined;
}

export function presentableWorkshopActions(): EmpaquetarCapabilityDefinition[] {
  return discoverWorkshopCapabilities()
    .filter((row) => row.actionKey)
    .slice()
    .sort((a, b) => (a.defaultActionOrder || 99) - (b.defaultActionOrder || 99));
}

export function defaultWorkshopActionOrder(): EmpaquetarActionKey[] {
  return presentableWorkshopActions().map((row) => row.actionKey as EmpaquetarActionKey);
}
