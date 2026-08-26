/** Real product version from package.json (ai-upscaler-pro). Configurable, not a hardcoded UI warning. */
export const PRODUCT_VERSION = '0.8.0-beta';
export const PRODUCT_BUILD_VERSION = '0.8.0-beta';

export type ReleaseChannel = 'beta' | 'stable' | 'internal';
export type VersionStatus = 'BETA' | 'STABLE' | 'INTERNAL';

export interface ProductMetadata {
  productVersion: string;
  releaseChannel: ReleaseChannel;
  versionStatus: VersionStatus;
  buildVersion: string;
}

export function defaultProductMetadata(): ProductMetadata {
  const beta = PRODUCT_VERSION.toLowerCase().includes('beta');
  return {
    productVersion: PRODUCT_VERSION,
    releaseChannel: beta ? 'beta' : 'stable',
    versionStatus: beta ? 'BETA' : 'STABLE',
    buildVersion: PRODUCT_BUILD_VERSION,
  };
}

export interface WorkshopProductUi extends ProductMetadata {
  showBetaLabel: boolean;
  betaLabel: string;
}

export interface CustomerProductUi {
  productVersion: string;
}

export function workshopProductUi(meta: ProductMetadata = defaultProductMetadata()): WorkshopProductUi {
  const showBetaLabel = meta.versionStatus === 'BETA' || meta.releaseChannel === 'beta';
  return {
    ...meta,
    showBetaLabel,
    betaLabel: showBetaLabel ? 'ESTA ES UNA VERSIÓN BETA' : '',
  };
}

export function customerProductUi(meta: ProductMetadata = defaultProductMetadata()): CustomerProductUi {
  return { productVersion: meta.productVersion };
}
