import { buildApparelExport } from '../../modules/apparel-studio/export';
import { resolveUniversalMoldeWithOptions } from '../../modules/apparel-studio/moldes/engine/molde-options-engine';
import type { CollarId, FabricId, MoldeId, SleeveId, Talle } from '../../modules/apparel-studio/moldes/types';
import type { DesignDistribution } from '../../contracts/design-distribution';
import type { FamilyStyleConfig } from '../../contracts/garment-family-style';
import { moldIdForGarment, type GarmentType } from '../../contracts/order-configuration-domain';
import type { ProductionArtifact, ProductionOutputSpec } from '../../contracts/order-production-output';

const MOLDE_TALLE = new Set(['S', 'M', 'L', 'XL', 'XXL', 'T4', 'T6', 'T8', 'T10', 'T12', 'T14']);

const INDUSTRIAL_JOBS: Array<{ purpose: 'cutting' | 'print' | 'sublimation'; format: 'svg' | 'pdf' | 'dxf' }> = [
  { purpose: 'cutting', format: 'dxf' },
  { purpose: 'cutting', format: 'pdf' },
  { purpose: 'cutting', format: 'svg' },
  { purpose: 'print', format: 'pdf' },
  { purpose: 'print', format: 'svg' },
  { purpose: 'sublimation', format: 'svg' },
];

export function buildIndustrialOrderArtifacts(input: {
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
    const style = input.styles?.[family.garmentType];
    const moldId = moldIdForGarment(family.garmentType) as MoldeId | undefined;
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
        style,
        designFileId: input.distribution.designFileId,
      };
      const slug = `${input.orderNumber}-${family.garmentType}-${sizeLabel}-r${input.revision}`.replace(
        /[^A-Za-z0-9._-]+/g,
        '_'
      );
      out.push({
        filename: `${slug}.json`,
        mimeType: 'application/json',
        format: 'json',
        contentUtf8: JSON.stringify(spec, null, 2),
        spec,
      });
      const talle = MOLDE_TALLE.has(sizeLabel.toUpperCase()) ? (sizeLabel.toUpperCase() as Talle) : undefined;
      if (!moldId || !talle) continue;
      const categoria = talle.startsWith('T') ? 'infantil' : 'adulto';
      const resolved = resolveUniversalMoldeWithOptions(moldId, categoria, talle, [], [], [], [], {
        collarId: style?.collarId as CollarId | undefined,
        sleeveId: style?.sleeveId as SleeveId | undefined,
      });
      if (!resolved?.piezas?.length) continue;
      const moldName = `${input.orderNumber} ${input.projectName} ${family.garmentType} ${sizeLabel} x${units} ${input.revisionId}`;
      for (const job of INDUSTRIAL_JOBS) {
        const result = buildApparelExport({
          purpose: job.purpose,
          format: job.format,
          moldId,
          moldName,
          categoria,
          talle,
          piezas: resolved.piezas,
          fabricId: (style?.fabricId as FabricId | undefined) || 'dry-fit',
        });
        const body = result.contentUtf8 || result.svgIntermediate;
        if (!body) continue;
        out.push({
          filename: `${slug}-${job.purpose}.${result.extension}`,
          mimeType: result.mimeType,
          format: job.format,
          contentUtf8: body,
          spec,
        });
      }
    }
  }
  return out;
}
