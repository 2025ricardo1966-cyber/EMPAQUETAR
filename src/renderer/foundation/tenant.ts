export type TenantCapabilities = {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  pickupByThirdPartyEnabled: boolean;
};

export const DEFAULT_TENANT_CAPABILITIES: TenantCapabilities = {
  pickupEnabled: true,
  deliveryEnabled: false,
  pickupByThirdPartyEnabled: false,
};

export function mapCapabilities(raw: unknown): TenantCapabilities {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    pickupEnabled: row.pickupEnabled !== false,
    deliveryEnabled: row.deliveryEnabled === true,
    pickupByThirdPartyEnabled: row.pickupByThirdPartyEnabled === true,
  };
}

export type TenantSnapshot = {
  tenantId: string;
  name?: string;
  currency?: string;
  defaultLanguage?: string;
  capabilities: TenantCapabilities;
};

export function mapTenant(raw: unknown, capabilities?: TenantCapabilities): TenantSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const tenantId = String(row.tenantId || row.id || '');
  if (!tenantId || tenantId === '__platform__') return null;
  const identity = (row.identity && typeof row.identity === 'object' ? row.identity : {}) as Record<string, unknown>;
  return {
    tenantId,
    name: String(row.name || identity.commercialName || ''),
    currency: String(row.currency || identity.currency || '') || undefined,
    defaultLanguage: String(row.defaultLanguage || identity.locale || '') || undefined,
    capabilities: capabilities || mapCapabilities(row.clientOptions),
  };
}
