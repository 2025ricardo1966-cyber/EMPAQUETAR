import { randomUUID } from 'crypto';
import { AccessDeniedError, type AuthContext } from '../../../contracts/admin-domain';
import { RequestInvalidError } from '../../../contracts/configuration-schema';
import {
  oraCapabilityCatalog,
  parseCommercialContext,
  parseConsumerKind,
  prepare16kPipeline,
  type OraCapabilityId,
  type OraCapabilityJob,
  type OraFileRef,
} from '../../../contracts/ora-core';
import { oraFileIntents, parseTargetFormat, detectGraphicFormat } from '../../../contracts/ora-file-conversion';
import { analyzeGraphicFile, convertGraphic, scaleGraphic, vectorizeGraphic } from './file-graphics';
import {
  assertLuggageSet,
  assertPhysicalSize,
  composeCandyBar,
  distributeOraBatch,
  flagFitness,
  matchPatternQuery,
  parseRequestedTalle,
  prepareDtfJob,
  productionPackManifest,
  type PatternCatalogEntry,
} from '../../../contracts/ora-engines';
import { DEFAULT_TPU_LIMITS, assertTpuDimensions } from '../../../contracts/order-configuration-domain';
import { extractStructuredDocument, documentDerivatives } from './document-intelligence';
import { convertCdrToPdf, isCorelDraw } from '../CdrConversion';
import { rasterSizeFromBytes } from './raster-size';
import { listCatalogSummaries } from '../../../modules/apparel-studio/moldes/catalog/mold-definitions';
import { resolveUniversalMoldeWithOptions } from '../../../modules/apparel-studio/moldes/engine/molde-options-engine';
import { buildApparelExport } from '../../../modules/apparel-studio/export';
import type { MoldeId, Talle } from '../../../modules/apparel-studio/moldes/types';
import type { ControlPlaneStore } from '../../../cloud/store/ControlPlaneStore';
import type { TraceService } from '../TraceService';

const MOLDE_TALLE = new Set(['S', 'M', 'L', 'XL', 'XXL', 'T4', 'T6', 'T8', 'T10', 'T12', 'T14']);

function decodeBase64(contentBase64: string): Buffer {
  const bytes = Buffer.from(String(contentBase64 || ''), 'base64');
  if (!bytes.length) throw new RequestInvalidError('EMPTY_FILE');
  return bytes;
}

export class OraCapabilityAdapter {
  constructor(
    private store: ControlPlaneStore,
    private tracer: TraceService
  ) {}

  catalog() {
    return {
      umbrella: 'ORA',
      vertical: 'EMPAQUETAR',
      capabilities: oraCapabilityCatalog(),
      fileIntents: oraFileIntents(),
    };
  }

  async getJob(ctx: AuthContext, jobId: string) {
    this.assertActor(ctx);
    const job = await this.store.getCapabilityJob(jobId);
    if (!job || job.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (ctx.roleId === 'CUSTOMER' && job.actorId !== ctx.userId) throw new AccessDeniedError();
    return job;
  }

  async runCdrPdf(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const filename = String(body.filename || 'archivo.cdr');
    const mimeType = String(body.mimeType || 'application/x-coreldraw');
    if (!isCorelDraw(filename, mimeType)) throw new RequestInvalidError('NOT_CDR');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const converted = convertCdrToPdf(filename, original);
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    const derivedRef = await this.putFile(
      ctx,
      filename.replace(/\.cdr$/i, '') + '.pdf',
      'application/pdf',
      converted.pdf,
      'DERIVED'
    );
    return this.persist(ctx, 'CDR_PDF', body, originalRef, [derivedRef], converted.warnings, {
      equivalent: false,
      originalPreserved: true,
      physical: converted.physical,
      colorSpaces: converted.profile.spaces,
    });
  }

  async runFlags(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const filename = String(body.filename || 'bandera.png');
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const physical = assertPhysicalSize(Number(body.widthMm), Number(body.heightMm));
    const raster = rasterSizeFromBytes(filename, original);
    const sourceIsVector = filename.toLowerCase().endsWith('.svg') || mimeType.includes('svg');
    const fit = flagFitness({
      raster,
      physical,
      keepProportion: body.keepProportion !== false,
      sourceIsVector,
    });
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    const derived: OraFileRef[] = [];
    if (fit.fitness !== 'NO_APTO') {
      const spec = Buffer.from(
        JSON.stringify({ capability: 'FLAGS', physical, raster, ppi: fit.ppi, fitness: fit.fitness }, null, 2),
        'utf8'
      );
      derived.push(await this.putFile(ctx, `${filename}.production.json`, 'application/json', spec, 'PRODUCTION'));
    }
    return this.persist(ctx, 'FLAGS', body, originalRef, derived, fit.warnings, {
      physical,
      raster,
      ppi: fit.ppi,
      fitness: fit.fitness,
      readyFor16k: true,
    });
  }

  async searchPatterns(ctx: AuthContext, query: string) {
    this.assertActor(ctx);
    const catalog = this.patternCatalog();
    const matches = matchPatternQuery(query, catalog);
    const talle = parseRequestedTalle(query);
    return {
      query,
      talle,
      matches: matches.slice(0, 12).map((m) => ({
        ...m,
        validation: 'INDUSTRIAL_CATALOG' as const,
      })),
      inferenceNote:
        'Una coincidencia de texto no es un molde industrial validado hasta resolver el catálogo y el talle.',
    };
  }

  async resolvePattern(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const moldId = String(body.moldId || '') as MoldeId;
    const talleRaw = String(body.talle || 'M').toUpperCase();
    if (!MOLDE_TALLE.has(talleRaw)) throw new RequestInvalidError('SIZE_NOT_FOUND');
    const talle = talleRaw as Talle;
    const categoria = talle.startsWith('T') ? 'infantil' : 'adulto';
    const resolved = resolveUniversalMoldeWithOptions(moldId, categoria, talle, [], [], [], [], {});
    if (!resolved?.piezas?.length) throw new RequestInvalidError('ORA_PATTERN_NOT_FOUND');
    const cutting = buildApparelExport({
      purpose: 'cutting',
      format: 'svg',
      moldId,
      moldName: resolved.nombre || moldId,
      categoria,
      talle,
      piezas: resolved.piezas,
    });
    const svg = Buffer.from(cutting.contentUtf8 || cutting.svgIntermediate || '', 'utf8');
    const derived = await this.putFile(ctx, `${moldId}-${talle}-corte.svg`, 'image/svg+xml', svg, 'PRODUCTION');
    return this.persist(ctx, 'PATTERN_LIBRARY', body, undefined, [derived], [], {
      validation: 'INDUSTRIAL_CATALOG',
      moldId,
      talle,
      categoria,
      pieceCount: resolved.piezas.length,
    });
  }

  async runCandyBar(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const filename = String(body.filename || 'candy.png');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const raster = rasterSizeFromBytes(filename, original);
    const composed = composeCandyBar(
      {
        itemWidthMm: Number(body.widthMm),
        itemHeightMm: Number(body.heightMm),
        quantity: Number(body.quantity),
        bleedMm: body.bleedMm != null ? Number(body.bleedMm) : undefined,
        sheetWidthMm: body.sheetWidthMm != null ? Number(body.sheetWidthMm) : undefined,
        sheetHeightMm: body.sheetHeightMm != null ? Number(body.sheetHeightMm) : undefined,
      },
      raster
    );
    const originalRef = await this.putFile(ctx, filename, String(body.mimeType || 'image/png'), original, 'ORIGINAL');
    const json = Buffer.from(JSON.stringify(composed, null, 2), 'utf8');
    const derived = [await this.putFile(ctx, 'candy-bar-layout.json', 'application/json', json, 'PRODUCTION')];
    const svg = this.layoutSvg('CANDY_BAR', composed.sheet.widthMm, composed.sheet.heightMm, composed.placements);
    derived.push(await this.putFile(ctx, 'candy-bar-layout.svg', 'image/svg+xml', Buffer.from(svg, 'utf8'), 'DERIVED'));
    return this.persist(ctx, 'CANDY_BAR', body, originalRef, derived, composed.warnings, {
      fitness: composed.fitness,
      quantity: composed.quantity,
      sheet: composed.sheet,
    });
  }

  async runLuggage(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const viewsRaw = Array.isArray(body.views) ? body.views : [];
    const views = [];
    const originals: OraFileRef[] = [];
    for (const row of viewsRaw) {
      const r = (row || {}) as Record<string, unknown>;
      const filename = String(r.filename || `${r.view || 'vista'}.png`);
      const bytes = decodeBase64(String(r.contentBase64 || ''));
      const file = await this.putFile(ctx, filename, String(r.mimeType || 'image/png'), bytes, 'ORIGINAL');
      originals.push(file);
      views.push({
        view: String(r.view || '') as 'FRENTE' | 'DORSO' | 'LATERAL_DERECHO' | 'LATERAL_IZQUIERDO',
        fileId: file.fileId,
        filename,
        raster: rasterSizeFromBytes(filename, bytes),
      });
    }
    const checked = assertLuggageSet({
      variant: body.variant === 'CARRY_ON' ? 'CARRY_ON' : 'STANDARD',
      widthMm: Number(body.widthMm),
      heightMm: Number(body.heightMm),
      depthMm: Number(body.depthMm),
      views,
    });
    const json = Buffer.from(JSON.stringify(checked, null, 2), 'utf8');
    const derived = [await this.putFile(ctx, 'luggage-cover.json', 'application/json', json, 'PRODUCTION')];
    return this.persist(ctx, 'LUGGAGE_COVER', body, originals[0], [...originals.slice(1), ...derived], checked.warnings, {
      variant: checked.variant,
      measures: checked.measures,
      fitness: checked.fitness,
      sameObject: true,
      missing: checked.missing,
    });
  }

  async runBatch(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const units = Array.isArray(body.units) ? (body.units as Array<{ key: string; quantity: number }>) : [];
    const out = distributeOraBatch({
      designFileId: String(body.designFileId || 'design'),
      units,
    });
    const json = Buffer.from(JSON.stringify(out, null, 2), 'utf8');
    const derived = [await this.putFile(ctx, 'batch-distribution.json', 'application/json', json, 'PRODUCTION')];
    return this.persist(ctx, 'BATCH_DESIGN', body, undefined, derived, out.warnings, {
      totalUnits: out.totalUnits,
      byKey: out.byKey,
      empaquetarMaxUnitsNotApplied: true,
    });
  }

  async prepare16k(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    let raster;
    let originalRef: OraFileRef | undefined;
    if (body.contentBase64) {
      const filename = String(body.filename || 'image.png');
      const bytes = decodeBase64(String(body.contentBase64));
      raster = rasterSizeFromBytes(filename, bytes);
      originalRef = await this.putFile(ctx, filename, String(body.mimeType || 'image/png'), bytes, 'ORIGINAL');
    }
    const prepared = prepare16kPipeline({
      filename: body.filename ? String(body.filename) : undefined,
      widthPx: raster?.widthPx,
      heightPx: raster?.heightPx,
    });
    return this.persist(ctx, 'IMAGE_16K', body, originalRef, [], ['PROCESS_16K_NOT_EXECUTED'], prepared);
  }

  async analyzeFile(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const started = Date.now();
    const filename = String(body.filename || 'archivo');
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const analyzed = analyzeGraphicFile(filename, mimeType, original, {
      widthMm: body.widthMm != null ? Number(body.widthMm) : undefined,
      heightMm: body.heightMm != null ? Number(body.heightMm) : undefined,
    });
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    return this.persist(
      ctx,
      'FILE_CONVERSION',
      body,
      originalRef,
      [],
      analyzed.diagnosis.warnings,
      {
        operation: 'ANALYZE',
        formatOrigin: analyzed.diagnosis.format,
        diagnosis: analyzed.diagnosis,
        compatibleOperations: analyzed.operations,
        originalPreserved: true,
        destructive: false,
      },
      { operation: 'ANALYZE', formatOrigin: analyzed.diagnosis.format, started }
    );
  }

  async convertFile(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const started = Date.now();
    const filename = String(body.filename || 'archivo');
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const target = parseTargetFormat(body.target || body.formatDestination);
    const converted = convertGraphic({ filename, mimeType, bytes: original, target });
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    const derived = [
      await this.putFile(ctx, converted.filename, converted.mimeType, converted.bytes, 'DERIVED'),
    ];
    return this.persist(
      ctx,
      'FILE_CONVERSION',
      body,
      originalRef,
      derived,
      converted.warnings,
      {
        operation: 'CONVERT',
        formatOrigin: filename,
        formatDestination: target,
        vectorKind: converted.vectorKind,
        originalPreserved: true,
        equivalent: false,
        propertiesLost: converted.propertiesLost,
      },
      { operation: 'CONVERT', formatOrigin: detectGraphicFormat(filename, mimeType, original), formatDestination: target, started }
    );
  }

  async vectorizeFile(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const started = Date.now();
    const filename = String(body.filename || 'archivo');
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const out = vectorizeGraphic(filename, mimeType, original);
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    const derived = [await this.putFile(ctx, out.filename, out.mimeType, out.bytes, 'DERIVED')];
    return this.persist(
      ctx,
      'FILE_CONVERSION',
      body,
      originalRef,
      derived,
      out.warnings,
      {
        operation: 'VECTORIZE',
        vectorKind: out.vectorKind,
        originalPreserved: true,
        propertiesLost: out.propertiesLost,
      },
      { operation: 'VECTORIZE', formatOrigin: detectGraphicFormat(filename, mimeType, original), formatDestination: 'svg', started }
    );
  }

  async scaleFile(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const started = Date.now();
    const filename = String(body.filename || 'archivo');
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const targetLabel = String(body.target || body.scale || '16K').toUpperCase();
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    if (targetLabel === '8K' || targetLabel === '16K') {
      const prepared = prepare16kPipeline({ filename });
      if (targetLabel === '8K') prepared.target = { widthPx: 7680, heightPx: 4320, label: '8K' };
      return this.persist(
        ctx,
        'FILE_CONVERSION',
        body,
        originalRef,
        [],
        ['PROCESS_16K_NOT_EXECUTED', 'NO_FAKE_CLOUD_SCALE'],
        {
          operation: 'SCALE',
          target: targetLabel,
          prepared,
          originalPreserved: true,
          executable: false,
        },
        { operation: 'SCALE', formatOrigin: detectGraphicFormat(filename, mimeType, original), formatDestination: targetLabel, started }
      );
    }
    const widthPx = Number(body.widthPx);
    const heightPx = Number(body.heightPx);
    const out = scaleGraphic({ filename, mimeType, bytes: original, target: { widthPx, heightPx } });
    const derived = [await this.putFile(ctx, out.filename, out.mimeType, out.bytes, 'DERIVED')];
    return this.persist(
      ctx,
      'FILE_CONVERSION',
      body,
      originalRef,
      derived,
      out.warnings,
      {
        operation: 'SCALE',
        originalPreserved: true,
        propertiesLost: out.propertiesLost,
      },
      { operation: 'SCALE', formatOrigin: 'png', formatDestination: 'png', started }
    );
  }

  async preflightFile(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const started = Date.now();
    const filename = String(body.filename || 'archivo');
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const analyzed = analyzeGraphicFile(filename, mimeType, original, {
      widthMm: body.widthMm != null ? Number(body.widthMm) : undefined,
      heightMm: body.heightMm != null ? Number(body.heightMm) : undefined,
    });
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    const report = Buffer.from(JSON.stringify(analyzed.diagnosis, null, 2), 'utf8');
    const derived = [await this.putFile(ctx, `${filename}.preflight.json`, 'application/json', report, 'REPORT')];
    return this.persist(
      ctx,
      'FILE_CONVERSION',
      body,
      originalRef,
      derived,
      analyzed.diagnosis.warnings,
      {
        operation: 'ANALYZE',
        intent: 'PREFLIGHT',
        fitness: analyzed.diagnosis.fitness || 'APTO_CON_ADVERTENCIA',
        diagnosis: analyzed.diagnosis,
        originalPreserved: true,
        destructive: false,
      },
      { operation: 'PREFLIGHT', formatOrigin: analyzed.diagnosis.format, started }
    );
  }

  async preparePrint(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const started = Date.now();
    const filename = String(body.filename || 'archivo');
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const physical = assertPhysicalSize(Number(body.widthMm), Number(body.heightMm));
    const analyzed = analyzeGraphicFile(filename, mimeType, original, physical);
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    const spec = Buffer.from(
      JSON.stringify(
        {
          intent: 'PREPARE_PRINT',
          physical,
          diagnosis: analyzed.diagnosis,
          fitness: analyzed.diagnosis.fitness,
        },
        null,
        2
      ),
      'utf8'
    );
    const derived = [await this.putFile(ctx, `${filename}.print.json`, 'application/json', spec, 'PRINT')];
    return this.persist(
      ctx,
      'FILE_CONVERSION',
      body,
      originalRef,
      derived,
      analyzed.diagnosis.warnings,
      {
        operation: 'PREPARE_PRINT',
        physical,
        fitness: analyzed.diagnosis.fitness,
        originalPreserved: true,
        needsScale: analyzed.diagnosis.fitness === 'NO_APTO' || analyzed.diagnosis.warnings.includes('RESOLUTION_INSUFFICIENT'),
      },
      { operation: 'PREPARE_PRINT', formatOrigin: analyzed.diagnosis.format, started }
    );
  }

  async runDtf(ctx: AuthContext, body: Record<string, unknown>, capability: 'DTF' | 'DTF_UV') {
    this.assertActor(ctx);
    const started = Date.now();
    const filename = String(body.filename || 'dtf.png');
    const mimeType = String(body.mimeType || 'image/png');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const physical = assertPhysicalSize(Number(body.widthMm), Number(body.heightMm));
    const analyzed = analyzeGraphicFile(filename, mimeType, original, physical);
    const prepared = prepareDtfJob({
      kind: capability === 'DTF_UV' ? 'DTF_UV' : 'DTF_TEXTILE',
      physical,
      raster: analyzed.diagnosis.widthPx
        ? { widthPx: analyzed.diagnosis.widthPx, heightPx: analyzed.diagnosis.heightPx || analyzed.diagnosis.widthPx }
        : undefined,
      transparency: analyzed.diagnosis.transparency,
      format: analyzed.diagnosis.format,
      sourceIsVector: analyzed.diagnosis.nature === 'vector',
    });
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    const derived: OraFileRef[] = [];
    if (prepared.fitness !== 'NO_APTO') {
      derived.push(
        await this.putFile(
          ctx,
          'dtf-production.json',
          'application/json',
          Buffer.from(JSON.stringify(prepared, null, 2), 'utf8'),
          'PRODUCTION'
        )
      );
      derived.push(
        await this.putFile(
          ctx,
          'dtf-layout.svg',
          'image/svg+xml',
          Buffer.from(
            this.layoutSvg('DTF', physical.widthMm, physical.heightMm, [
              { xMm: 0, yMm: 0, widthMm: physical.widthMm, heightMm: physical.heightMm, index: 1 },
            ]),
            'utf8'
          ),
          'PRINT'
        )
      );
    }
    derived.push(
      await this.putFile(
        ctx,
        'dtf-report.md',
        'text/markdown',
        Buffer.from(
          `# ${capability}\n\nFitness: ${prepared.fitness}\n\n${prepared.warnings.map((w) => `- ${w}`).join('\n')}\n`,
          'utf8'
        ),
        'REPORT'
      )
    );
    return this.persist(
      ctx,
      capability,
      body,
      originalRef,
      derived,
      prepared.warnings,
      {
        ...prepared,
        originalPreserved: true,
        equivalent: false,
      },
      { operation: capability, formatOrigin: analyzed.diagnosis.format, started }
    );
  }

  async runDocumentIntelligence(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const started = Date.now();
    const filename = String(body.filename || 'documento.pdf');
    const mimeType = String(body.mimeType || 'application/pdf');
    const original = decodeBase64(String(body.contentBase64 || ''));
    const extraction = extractStructuredDocument(filename, mimeType, original);
    const files = documentDerivatives(filename, extraction);
    const originalRef = await this.putFile(ctx, filename, mimeType, original, 'ORIGINAL');
    const derived = [
      await this.putFile(ctx, 'document.txt', 'text/plain', files.txt, 'DERIVED'),
      await this.putFile(ctx, 'document.md', 'text/markdown', files.md, 'DERIVED'),
      await this.putFile(ctx, 'document.html', 'text/html', files.html, 'DERIVED'),
      await this.putFile(ctx, 'document-report.json', 'application/json', files.json, 'REPORT'),
    ];
    return this.persist(
      ctx,
      'DOCUMENT_INTELLIGENCE',
      body,
      originalRef,
      derived,
      extraction.warnings,
      {
        validation: extraction.validation,
        ocrExecuted: false,
        pages: extraction.pages,
        lowConfidence: extraction.lowConfidence,
        structure: extraction.structure,
        skipped: files.skipped,
        originalPreserved: true,
      },
      { operation: 'DOCUMENT_INTELLIGENCE', formatOrigin: detectGraphicFormat(filename, mimeType, original), started }
    );
  }

  async runProductionPack(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const source = await this.getJob(ctx, String(body.jobId || ''));
    const files: Array<{ fileId: string; filename: string; role: string; folder: string }> = [];
    if (source.original) {
      files.push({
        fileId: source.original.fileId,
        filename: source.original.filename,
        role: source.original.role,
        folder: 'ORIGINAL',
      });
    }
    for (const d of source.derived) {
      const folder =
        d.role === 'PRINT'
          ? 'PRINT'
          : d.role === 'VECTOR'
            ? 'VECTOR'
            : d.role === 'REPORT'
              ? 'REPORT'
              : d.role === 'PRODUCTION'
                ? 'PRODUCTION'
                : 'DERIVADOS';
      files.push({ fileId: d.fileId, filename: d.filename, role: d.role, folder });
    }
    const manifest = productionPackManifest({
      jobId: source.jobId,
      capability: source.capability,
      version: source.version,
      createdAt: source.createdAt,
      warnings: source.warnings,
      files,
    });
    const derived = [
      await this.putFile(
        ctx,
        'production-pack.json',
        'application/json',
        Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
        'REPORT'
      ),
    ];
    return this.persist(ctx, 'PRODUCTION_PACK', body, source.original, derived, source.warnings, {
      sourceJobId: source.jobId,
      manifest,
      originalPreserved: true,
    });
  }

  async prepareTpu(ctx: AuthContext, body: Record<string, unknown>) {
    this.assertActor(ctx);
    const started = Date.now();
    const dims = assertTpuDimensions(body.width_mm ?? body.widthMm, body.height_mm ?? body.heightMm, DEFAULT_TPU_LIMITS);
    let originalRef: OraFileRef | undefined;
    if (body.contentBase64) {
      const filename = String(body.filename || 'tpu.png');
      originalRef = await this.putFile(
        ctx,
        filename,
        String(body.mimeType || 'image/png'),
        decodeBase64(String(body.contentBase64)),
        'ORIGINAL'
      );
    }
    const spec = Buffer.from(
      JSON.stringify(
        {
          capability: 'TPU',
          dimensions: dims,
          limits: { maxWidth_mm: DEFAULT_TPU_LIMITS.maxWidth_mm, maxHeight_mm: DEFAULT_TPU_LIMITS.maxHeight_mm },
          source: 'DEFAULT_TPU_LIMITS',
          note: 'Límites del contrato TPUAdminConfig. No es un motor paralelo ni un pedido EMPAQUETAR.',
        },
        null,
        2
      ),
      'utf8'
    );
    const derived = [await this.putFile(ctx, 'tpu-prepare.json', 'application/json', spec, 'PRODUCTION')];
    return this.persist(
      ctx,
      'TPU',
      body,
      originalRef,
      derived,
      ['TPU_WORKSHOP_SNAPSHOT_NOT_BOUND'],
      { dimensions: dims, originalPreserved: true, orderNotCreated: true },
      { operation: 'TPU_PREPARE', started }
    );
  }

  private patternCatalog(): PatternCatalogEntry[] {
    return listCatalogSummaries().map((m) => ({
      id: m.id,
      name: m.nombre,
      category: m.categoria,
      description: m.descripcion,
      garment: m.nombre,
      variant: m.id,
      version: 'catalog-1',
      units: 'cm',
      validation: 'INDUSTRIAL_CATALOG',
    }));
  }

  private layoutSvg(
    title: string,
    widthMm: number,
    heightMm: number,
    placements: Array<{ xMm: number; yMm: number; widthMm: number; heightMm: number; index: number }>
  ): string {
    const rects = placements
      .map(
        (p) =>
          `<rect x="${p.xMm}" y="${p.yMm}" width="${p.widthMm}" height="${p.heightMm}" fill="none" stroke="#111" stroke-width="0.4"/><text x="${p.xMm + 2}" y="${p.yMm + 6}" font-size="4">${p.index}</text>`
      )
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}"><title>${title}</title>${rects}</svg>`;
  }

  private async putFile(
    ctx: AuthContext,
    filename: string,
    mimeType: string,
    bytes: Buffer,
    role: OraFileRef['role']
  ): Promise<OraFileRef> {
    const fileId = randomUUID();
    const storageKey = await this.store.writeBlob(fileId, bytes);
    return { fileId, role, filename, mimeType, storageKey, sizeBytes: bytes.length };
  }

  private async persist(
    ctx: AuthContext,
    capability: OraCapabilityId,
    body: Record<string, unknown>,
    original: OraFileRef | undefined,
    derived: OraFileRef[],
    warnings: string[],
    result: Record<string, unknown>,
    extras?: {
      operation?: string;
      formatOrigin?: string;
      formatDestination?: string;
      started?: number;
    }
  ) {
    const now = Date.now();
    const bytesIn = original?.sizeBytes || 0;
    const bytesOut = derived.reduce((s, f) => s + f.sizeBytes, 0);
    const durationMs = extras?.started ? now - extras.started : 0;
    const job: OraCapabilityJob = {
      jobId: `ora_${randomUUID()}`,
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      capability,
      status: 'completed',
      identity: {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        consumerKind: parseConsumerKind(ctx.roleId),
      },
      commercial: {
        context: parseCommercialContext(body.commercialContext),
        tariffCode: body.tariffCode ? String(body.tariffCode) : undefined,
        usage: {
          capability,
          bytesIn,
          bytesOut,
          durationMs,
          operation: extras?.operation,
          formatOrigin: extras?.formatOrigin,
          formatDestination: extras?.formatDestination,
          resolution: result.prepared ? String((result.prepared as { target?: { label?: string } }).target?.label || '') : undefined,
          inputBytes: bytesIn,
          outputBytes: bytesOut,
          processingDuration: durationMs,
        },
      },
      original,
      derived,
      warnings,
      result,
      orderId: body.orderId ? String(body.orderId) : undefined,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveCapabilityJob(job);
    await this.tracer.record({
      tenantId: ctx.tenantId,
      entityType: 'job',
      entityId: job.jobId,
      eventType: 'JOB_SUCCEEDED',
      actorType: ctx.roleId === 'CUSTOMER' ? 'CUSTOMER' : 'ADMIN',
      actorId: ctx.userId,
      metadata: {
        capability,
        originalFileId: original?.fileId || '',
        derivedCount: String(derived.length),
        warnings: warnings.join('|'),
      },
      correlationId: job.jobId,
    });
    return job;
  }

  private assertActor(ctx: AuthContext) {
    if (!ctx.tenantId || !ctx.userId) throw new AccessDeniedError();
    if (!['CUSTOMER', 'ADMIN_PRINCIPAL', 'ADMIN', 'SUBADMIN', 'OPERATOR'].includes(ctx.roleId)) {
      throw new AccessDeniedError();
    }
  }
}
