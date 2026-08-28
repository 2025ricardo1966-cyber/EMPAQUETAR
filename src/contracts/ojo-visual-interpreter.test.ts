import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpretIngestedDesign } from '../main/services/ojo/VisualInterpreter';

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
  assert.equal(diagnosis.layer.zone, 'front');
  assert.ok(diagnosis.layer.proportion);
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
