/** Presentation-only client flow configuration. Does not alter production gates, FSM, or order history. */

export const FLOW_FEATURE_KEYS = [
  'ojo',
  'ojo_zone',
  'ojo_rect',
  'ojo_ellipse',
  'ojo_hint',
  'ojo_scale',
  'download_2d',
  'download_3d',
  'preview_3d',
  'continue_production',
  'excel_upload',
  'messaging',
  'consumption',
  'materials',
  'client_approval',
] as const;

export type FlowFeatureKey = (typeof FLOW_FEATURE_KEYS)[number];

/** Presentable actions whose visual order the admin can change. */
export const FLOW_ACTION_KEYS = ['preview', 'download_2d', 'download_3d', 'continue_production'] as const;
export type FlowActionKey = (typeof FLOW_ACTION_KEYS)[number];

export interface FlowFeatureDefinition {
  key: FlowFeatureKey;
  label: string;
  /** Features that must also be enabled for this one to appear. */
  requires?: FlowFeatureKey[];
}

export const FLOW_FEATURE_DEFINITIONS: FlowFeatureDefinition[] = [
  { key: 'ojo', label: 'OJO — interpretación visual' },
  { key: 'ojo_zone', label: 'Selección de zona', requires: ['ojo'] },
  { key: 'ojo_rect', label: 'Marco rectangular', requires: ['ojo', 'ojo_zone'] },
  { key: 'ojo_ellipse', label: 'Marco elíptico', requires: ['ojo', 'ojo_zone'] },
  { key: 'ojo_hint', label: 'Solicitud de pista cuando existe ambigüedad', requires: ['ojo'] },
  { key: 'ojo_scale', label: 'Escalado/preparación automática', requires: ['ojo'] },
  { key: 'download_2d', label: 'Descarga de muestra 2D' },
  { key: 'download_3d', label: 'Descarga de muestra 3D' },
  { key: 'preview_3d', label: 'Previsualización 3D' },
  { key: 'continue_production', label: 'Continuar a producción' },
  { key: 'excel_upload', label: 'Carga de Excel' },
  { key: 'messaging', label: 'Mensajería cliente/taller' },
  { key: 'consumption', label: 'Información de consumo' },
  { key: 'materials', label: 'Información de materia prima' },
  { key: 'client_approval', label: 'Solicitud de aprobación del cliente' },
];

export const FLOW_ACTION_DEFINITIONS: Array<{ key: FlowActionKey; label: string; feature?: FlowFeatureKey }> = [
  { key: 'preview', label: 'Previsualización' },
  { key: 'download_2d', label: 'Descargar muestra 2D', feature: 'download_2d' },
  { key: 'download_3d', label: 'Descargar muestra 3D', feature: 'download_3d' },
  { key: 'continue_production', label: 'Continuar a producción', feature: 'continue_production' },
];

export interface FlowFeatureState {
  featureKey: FlowFeatureKey;
  enabled: boolean;
  displayOrder: number;
}

export interface FlowConfiguration {
  version: 1;
  tenantId: string;
  features: FlowFeatureState[];
  actionOrder: FlowActionKey[];
  updatedAt: number;
  updatedBy?: string;
}

export interface ClientFlowPresentation {
  version: 1;
  features: Record<FlowFeatureKey, boolean>;
  actionOrder: FlowActionKey[];
  updatedAt: number;
}

function isFeatureKey(raw: string): raw is FlowFeatureKey {
  return (FLOW_FEATURE_KEYS as readonly string[]).includes(raw);
}

function isActionKey(raw: string): raw is FlowActionKey {
  return (FLOW_ACTION_KEYS as readonly string[]).includes(raw);
}

export function defaultFlowConfiguration(tenantId: string, now = Date.now()): FlowConfiguration {
  return {
    version: 1,
    tenantId,
    features: FLOW_FEATURE_KEYS.map((featureKey, i) => ({
      featureKey,
      enabled: true,
      displayOrder: i + 1,
    })),
    actionOrder: [...FLOW_ACTION_KEYS],
    updatedAt: now,
  };
}

export function parseFlowConfiguration(raw: unknown, tenantId: string, now = Date.now()): FlowConfiguration {
  const fallback = defaultFlowConfiguration(tenantId, now);
  if (!raw || typeof raw !== 'object') return fallback;
  const row = raw as Record<string, unknown>;
  const byKey = new Map<FlowFeatureKey, FlowFeatureState>();
  for (const item of fallback.features) byKey.set(item.featureKey, { ...item });
  const incoming = Array.isArray(row.features) ? row.features : [];
  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const key = String(rec.featureKey || rec.key || '');
    if (!isFeatureKey(key)) continue;
    const prev = byKey.get(key)!;
    byKey.set(key, {
      featureKey: key,
      enabled: rec.enabled !== false,
      displayOrder: Number.isFinite(Number(rec.displayOrder)) ? Number(rec.displayOrder) : prev.displayOrder,
    });
  }
  const features = FLOW_FEATURE_KEYS.map((key) => byKey.get(key)!).sort((a, b) => a.displayOrder - b.displayOrder);
  features.forEach((f, i) => {
    f.displayOrder = i + 1;
  });
  const seen = new Set<FlowActionKey>();
  const actionOrder: FlowActionKey[] = [];
  const rawOrder = Array.isArray(row.actionOrder) ? row.actionOrder : fallback.actionOrder;
  for (const item of rawOrder) {
    const key = String(item || '');
    if (!isActionKey(key) || seen.has(key)) continue;
    seen.add(key);
    actionOrder.push(key);
  }
  for (const key of FLOW_ACTION_KEYS) {
    if (!seen.has(key)) actionOrder.push(key);
  }
  return {
    version: 1,
    tenantId,
    features,
    actionOrder,
    updatedAt: Number(row.updatedAt) || now,
    updatedBy: row.updatedBy != null ? String(row.updatedBy) : undefined,
  };
}

export function flowFeatureEnabled(config: FlowConfiguration, key: FlowFeatureKey): boolean {
  const def = FLOW_FEATURE_DEFINITIONS.find((d) => d.key === key);
  const self = config.features.find((f) => f.featureKey === key);
  if (!self || self.enabled === false) return false;
  for (const req of def?.requires || []) {
    if (!flowFeatureEnabled(config, req)) return false;
  }
  return true;
}

export function presentClientFlow(config: FlowConfiguration): ClientFlowPresentation {
  const features = {} as Record<FlowFeatureKey, boolean>;
  for (const key of FLOW_FEATURE_KEYS) {
    features[key] = flowFeatureEnabled(config, key);
  }
  return {
    version: 1,
    features,
    actionOrder: [...config.actionOrder],
    updatedAt: config.updatedAt,
  };
}

export interface ResolvedFlowAction {
  key: FlowActionKey;
  label: string;
  visible: boolean;
}

/**
 * UI visibility for presentable actions. Never implies business authorization.
 * `preview3dValid` must already come from the product/OJO viewer — this layer does not invent it.
 */
export function resolveFlowActions(
  presentation: ClientFlowPresentation,
  ctx: { previewMode?: '2D' | '3D'; sample3dAvailable?: boolean; previewReady?: boolean }
): ResolvedFlowAction[] {
  const preview3dValid = ctx.previewMode === '3D' && !!ctx.sample3dAvailable;
  return presentation.actionOrder.map((key) => {
    const def = FLOW_ACTION_DEFINITIONS.find((d) => d.key === key)!;
    let visible = true;
    if (def.feature && presentation.features[def.feature] === false) visible = false;
    if (key === 'preview' && presentation.features.preview_3d === false && ctx.previewMode === '3D') {
      visible = false;
    }
    if (key === 'download_3d') {
      if (!presentation.features.download_3d) visible = false;
      else if (!preview3dValid) visible = false;
    }
    if (key === 'download_2d' && !presentation.features.download_2d) visible = false;
    if (key === 'continue_production' && !presentation.features.continue_production) visible = false;
    return { key, label: def.label, visible };
  });
}

export function readFlowConfiguration(tenantConfig: { tenantId: string; config?: Record<string, unknown> } | undefined): FlowConfiguration {
  const tenantId = tenantConfig?.tenantId || '';
  return parseFlowConfiguration(tenantConfig?.config?.flowConfiguration, tenantId);
}

export function writeFlowConfiguration(
  tenantConfig: { config?: Record<string, unknown> },
  flow: FlowConfiguration
): Record<string, unknown> {
  return { ...(tenantConfig.config || {}), flowConfiguration: flow };
}
