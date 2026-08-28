import { RequestInvalidError } from './configuration-schema';
import { selectedGarmentTypesOf, type DesignDistribution } from './design-distribution';
import type { FamilyStyleConfig } from './garment-family-style';
import type { GarmentType } from './order-configuration-domain';

export interface ProductionOutputSpec {
  orderId: string;
  orderNumber: string;
  projectName: string;
  revisionId: string;
  revision: number;
  generatedAt: number;
  family: GarmentType;
  sizeLabel: string;
  units: number;
  style?: FamilyStyleConfig;
  designFileId?: string;
}

export interface ProductionArtifact {
  filename: string;
  mimeType: string;
  format: 'svg' | 'json' | 'pdf' | 'dxf';
  contentUtf8: string;
  spec: ProductionOutputSpec;
}

export function assertCanGenerateOutputs(input: {
  rosterStatus?: string;
  selectedGarmentTypes?: string[];
  productionRevisionId?: string;
  designFileId?: string;
  previewApproved?: boolean;
  rawMaterial?: boolean;
}): void {
  const selected = input.selectedGarmentTypes || [];
  if (selected.length && input.rosterStatus === 'PENDING_REVIEW') {
    throw new RequestInvalidError('ROSTER_PENDING');
  }
  if (selected.length && input.rosterStatus && input.rosterStatus !== 'APPROVED') {
    throw new RequestInvalidError('ROSTER_PENDING');
  }
  if (selected.length && !input.productionRevisionId) {
    throw new RequestInvalidError('PRODUCTION_NOT_APPROVED');
  }
  if (selected.length && !input.designFileId) {
    throw new RequestInvalidError('DESIGN_REQUIRED');
  }
  if (selected.length && !input.previewApproved && !input.rawMaterial) {
    throw new RequestInvalidError('PREVIEW_PENDING');
  }
}

export function productionOutputGateInput(formValues?: Record<string, unknown> | null): {
  rosterStatus?: string;
  selectedGarmentTypes: string[];
  productionRevisionId?: string;
  designFileId?: string;
  previewApproved?: boolean;
  rawMaterial?: boolean;
} {
  const fv = formValues || {};
  const intake = fv.rosterIntake as { status?: string } | undefined;
  const revision = fv.productionRevision as { id?: string } | undefined;
  const designRaw = fv.designFileId != null ? String(fv.designFileId).trim() : '';
  return {
    rosterStatus: intake?.status,
    selectedGarmentTypes: selectedGarmentTypesOf(fv),
    productionRevisionId: revision?.id,
    designFileId: designRaw || undefined,
    previewApproved: !!fv.previewApproved,
    rawMaterial: !!fv.rawMaterialRequested,
  };
}

/** Single production gate: roster + design + preview APPROVED or RAW. */
export function assertOrderCanGenerateOutputs(formValues?: Record<string, unknown> | null): void {
  assertCanGenerateOutputs(productionOutputGateInput(formValues));
}

export function isProductionGateError(error: unknown): boolean {
  if (!(error instanceof RequestInvalidError)) return false;
  const detail = String(error.message || '').replace(/^REQUEST_INVALID:/, '');
  return (
    detail === 'PREVIEW_PENDING' ||
    detail === 'ROSTER_PENDING' ||
    detail === 'DESIGN_REQUIRED' ||
    detail === 'PRODUCTION_NOT_APPROVED'
  );
}

export function buildProductionArtifacts(input: {
  orderId: string;
  orderNumber: string;
  projectName: string;
  revision: number;
  revisionId: string;
  generatedAt: number;
  distribution: DesignDistribution;
  styles?: Partial<Record<GarmentType, FamilyStyleConfig>>;
}): ProductionArtifact[] {
  const out: ProductionArtifact[] = [];
  for (const family of input.distribution.families) {
    if (!family.units) continue;
    for (const [sizeLabel, units] of Object.entries(family.bySize || {})) {
      if (!units) continue;
      const spec: ProductionOutputSpec = {
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        projectName: input.projectName,
        revisionId: input.revisionId,
        revision: input.revision,
        generatedAt: input.generatedAt,
        family: family.garmentType,
        sizeLabel,
        units,
        style: input.styles?.[family.garmentType],
        designFileId: input.distribution.designFileId,
      };
      const slug = `${input.orderNumber}-${family.garmentType}-${sizeLabel}-r${input.revision}`
        .replace(/[^A-Za-z0-9._-]+/g, '_');
      out.push({
        filename: `${slug}.json`,
        mimeType: 'application/json',
        format: 'json',
        contentUtf8: JSON.stringify(spec, null, 2),
        spec,
      });
      out.push({
        filename: `${slug}.svg`,
        mimeType: 'image/svg+xml',
        format: 'svg',
        contentUtf8: productionSvg(spec),
        spec,
      });
    }
  }
  if (!out.length) throw new RequestInvalidError('OUTPUT_EMPTY');
  return out;
}

function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function productionSvg(spec: ProductionOutputSpec): string {
  const lines = [
    `Pedido ${spec.orderNumber}`,
    spec.projectName,
    `${spec.family} ${spec.sizeLabel} × ${spec.units}`,
    `rev ${spec.revision} ${spec.revisionId}`,
    new Date(spec.generatedAt).toISOString(),
  ];
  const texts = lines
    .map((line, i) => `<text x="24" y="${36 + i * 22}" font-size="14">${escapeXml(line)}</text>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200">
  <rect width="640" height="200" fill="#111" />
  <g fill="#f5f5f5">${texts}</g>
</svg>
`;
}
