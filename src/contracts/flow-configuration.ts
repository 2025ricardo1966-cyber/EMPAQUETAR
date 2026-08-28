/** Presentation-only tenant flow configuration. Consumes the EMPAQUETAR capability catalog. */

import {
  defaultWorkshopActionOrder,
  discoverWorkshopCapabilities,
  isEmpaquetarActionKey,
  isEmpaquetarCapabilityKey,
  presentableWorkshopActions,
  workshopCapabilityDefinition,
  type EmpaquetarActionKey,
  type EmpaquetarCapabilityDefinition,
  type EmpaquetarCapabilityKey,
} from './empaquetar-capabilities';

export type FlowFeatureKey = EmpaquetarCapabilityKey;
export type FlowActionKey = EmpaquetarActionKey;

export const FLOW_FEATURE_KEYS = discoverWorkshopCapabilities().map((row) => row.key);

export const FLOW_ACTION_KEYS = defaultWorkshopActionOrder();

export interface FlowFeatureDefinition {
  key: FlowFeatureKey;
  label: string;
  requires?: FlowFeatureKey[];
}

export const FLOW_FEATURE_DEFINITIONS: FlowFeatureDefinition[] = discoverWorkshopCapabilities().map((row) => ({
  key: row.key,
  label: row.label,
  requires: row.requires,
}));

export const FLOW_ACTION_DEFINITIONS: Array<{ key: FlowActionKey; label: string; feature?: FlowFeatureKey }> =
  presentableWorkshopActions().map((row) => ({
    key: row.actionKey as FlowActionKey,
    label: row.label,
    feature: row.key,
  }));

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
  capabilities?: Array<{ key: FlowFeatureKey; enabled: boolean; category: string }>;
}

function isFeatureKey(raw: string): raw is FlowFeatureKey {
  return isEmpaquetarCapabilityKey(raw) && !!workshopCapabilityDefinition(raw);
}

function isActionKey(raw: string): raw is FlowActionKey {
  return isEmpaquetarActionKey(raw);
}

function catalog(): EmpaquetarCapabilityDefinition[] {
  return discoverWorkshopCapabilities();
}

export function defaultFlowConfiguration(tenantId: string, now = Date.now()): FlowConfiguration {
  return {
    version: 1,
    tenantId,
    features: catalog().map((row, i) => ({
      featureKey: row.key,
      enabled: true,
      displayOrder: i + 1,
    })),
    actionOrder: defaultWorkshopActionOrder(),
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
    const def = workshopCapabilityDefinition(key);
    if (!def) continue;
    const prev = byKey.get(key)!;
    const requested = rec.enabled !== false;
    byKey.set(key, {
      featureKey: key,
      enabled: def.configurable ? requested : true,
      displayOrder: Number.isFinite(Number(rec.displayOrder)) ? Number(rec.displayOrder) : prev.displayOrder,
    });
  }
  const features = catalog()
    .map((def) => {
      const state = byKey.get(def.key)!;
      return { ...state, enabled: def.configurable ? state.enabled : true };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder);
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
  for (const key of defaultWorkshopActionOrder()) {
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
  const def = workshopCapabilityDefinition(key);
  if (!def) return false;
  const self = config.features.find((f) => f.featureKey === key);
  if (!def.configurable) return true;
  if (!self || self.enabled === false) return false;
  for (const req of def.requires || []) {
    if (!flowFeatureEnabled(config, req)) return false;
  }
  return true;
}

export function presentClientFlow(config: FlowConfiguration): ClientFlowPresentation {
  const features = {} as Record<FlowFeatureKey, boolean>;
  for (const def of catalog()) {
    features[def.key] = flowFeatureEnabled(config, def.key);
  }
  return {
    version: 1,
    features,
    actionOrder: [...config.actionOrder],
    updatedAt: config.updatedAt,
    capabilities: catalog().map((def) => ({
      key: def.key,
      enabled: features[def.key],
      category: def.category,
    })),
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
    const def = FLOW_ACTION_DEFINITIONS.find((d) => d.key === key);
    const cap = workshopCapabilityDefinition(def?.feature || key);
    let visible = true;
    if (def?.feature && presentation.features[def.feature] === false) visible = false;
    if (cap?.runtime?.requiresPreview3dValid && !preview3dValid) visible = false;
    if (key === 'download_3d' && !preview3dValid) visible = false;
    return { key, label: def?.label || cap?.label || key, visible };
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

export function resolveTenantCapabilities(
  flow: FlowConfiguration
): Array<{
  key: FlowFeatureKey;
  label: string;
  category: string;
  supported: true;
  availability: 'supported';
  configurable: boolean;
  requires: FlowFeatureKey[];
  enabled: boolean;
  displayOrder: number;
  tenantId: string;
  actionKey: FlowActionKey | null;
  commercialTier: null;
  commercialPrice: null;
  commercialCategory: string;
}> {
  const byKey = new Map(flow.features.map((f) => [f.featureKey, f]));
  return catalog()
    .map((def) => {
      const state = byKey.get(def.key);
      return {
        key: def.key,
        label: def.label,
        category: def.category,
        supported: true as const,
        availability: 'supported' as const,
        configurable: def.configurable,
        requires: [...(def.requires || [])],
        enabled: flowFeatureEnabled(flow, def.key),
        displayOrder: state?.displayOrder || 0,
        tenantId: flow.tenantId,
        actionKey: (def.actionKey as FlowActionKey | undefined) || null,
        commercialTier: null,
        commercialPrice: null,
        commercialCategory: def.commercialCategory,
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder);
}
