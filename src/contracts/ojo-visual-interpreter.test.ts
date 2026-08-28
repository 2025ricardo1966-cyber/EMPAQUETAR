import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpretIngestedDesign } from '../main/services/ojo/VisualInterpreter';
import { parseOjoHints, parseOjoRegion } from './visual-interpreter';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('OJO V1 flags tiny raster as prepare, never throws, never emits industrial files', () => {
  const diagnosis = interpretIngestedDesign({
    fileId: 'file-1',
    filename: 'diseno.png',
    mimeType: 'image/png',
    bytes: PNG_1X1,
  });
  assert.equal(diagnosis.version, 'v1');
  assert.equal(diagnosis.kind, 'raster_design');
  assert.equal(diagnosis.widthPx, 1);
  assert.equal(diagnosis.heightPx, 1);
  assert.equal(diagnosis.resolutionInsufficient, true);
  assert.equal(diagnosis.recommendScale, true);
  assert.equal(diagnosis.productionFitness, 'prepare');
  assert.equal(diagnosis.action, 'ESCALAR_PREPARAR');
  assert.equal(diagnosis.size.needsScale, true);
  assert.equal(diagnosis.layer.zone, 'front');
  assert.ok(diagnosis.layer.proportion);
  assert.equal(diagnosis.ambiguous, false);
});

test('OJO V1 never throws on unknown bytes and stays advisory', () => {
  const diagnosis = interpretIngestedDesign({
    fileId: 'file-x',
    filename: 'blob.bin',
    mimeType: 'application/octet-stream',
    bytes: Buffer.from('not-an-image'),
  });
  assert.equal(diagnosis.kind, 'unknown');
  assert.equal(diagnosis.humanIntervention, true);
  assert.equal(diagnosis.productionFitness, 'review');
  assert.equal(diagnosis.action, 'INTERVENCION_HUMANA');
  assert.equal(diagnosis.ambiguous, true);
});

test('OJO V1 treats PDF as document needing human review without blocking shape', () => {
  const diagnosis = interpretIngestedDesign({
    fileId: 'file-2',
    filename: 'arte.pdf',
    mimeType: 'application/pdf',
    bytes: Buffer.from('%PDF-1.4'),
  });
  assert.equal(diagnosis.kind, 'document');
  assert.equal(diagnosis.humanIntervention, true);
  assert.equal(diagnosis.productionFitness, 'review');
});

test('small rectangular region without hint is ambiguous; hint clears it', () => {
  const region = parseOjoRegion({ shape: 'rect', x: 0.1, y: 0.1, w: 0.12, h: 0.2 });
  assert.ok(region);
  const first = interpretIngestedDesign({
    fileId: 'file-1',
    filename: 'diseno.png',
    mimeType: 'image/png',
    bytes: PNG_1X1,
    region,
  });
  assert.equal(first.ambiguous, true);
  assert.equal(first.region?.shape, 'rect');
  assert.ok(Math.abs((first.region?.x || 0) - 0.1) < 1e-9);
  const hinted = interpretIngestedDesign({
    fileId: 'file-1',
    filename: 'diseno.png',
    mimeType: 'image/png',
    bytes: PNG_1X1,
    region,
    hints: parseOjoHints(['Número', 'DISEÑO']),
  });
  assert.equal(hinted.ambiguous, false);
  assert.deepEqual(hinted.hints, ['NUMERO', 'DISENO']);
  assert.ok(hinted.content.elements.includes('NUMERO'));
});

test('elliptical region is stored normalized and scale analysis uses TPU target', () => {
  const region = parseOjoRegion({ shape: 'ellipse', x: 0.2, y: 0.25, w: 0.5, h: 0.4 });
  const diagnosis = interpretIngestedDesign({
    fileId: 'file-1',
    filename: 'diseno.png',
    mimeType: 'image/png',
    bytes: PNG_1X1,
    region,
    hints: ['DISENO'],
    orderContext: { tpuWidthMm: 50.8, tpuHeightMm: 50.8 },
  });
  assert.equal(diagnosis.region?.shape, 'ellipse');
  assert.equal(diagnosis.ambiguous, false);
  assert.equal(diagnosis.size.targetWidthPx, 300);
  assert.equal(diagnosis.size.needsScale, true);
  assert.equal(diagnosis.action, 'ESCALAR_PREPARAR');
  assert.ok(diagnosis.risk.includes('UPSCALE_REQUIRED'));
});
