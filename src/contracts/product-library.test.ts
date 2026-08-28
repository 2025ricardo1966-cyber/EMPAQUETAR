import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  approvalMatchesVisual,
  getProductById,
  listProductLibrary,
  previewModeOf,
  PRODUCT_NAME_NORMALIZATIONS,
  resolveProduct,
  visualVersionFromForm,
} from './product-library';

test('Bandera uses planar 2D preview; Remera uses 3D; Short de fútbol is distinct', () => {
  const bandera = resolveProduct({ name: 'Bandera' });
  const remera = resolveProduct({ name: 'Remera cuello redondo' });
  const shortFutbol = resolveProduct({ name: 'Short de fútbol' });
  const shortDeportivo = resolveProduct({ name: 'Short deportivo' });
  const shortCiclismo = resolveProduct({ name: 'Short de ciclismo' });
  const bermuda = resolveProduct({ name: 'Bermuda deportiva' });

  assert.equal(bandera?.id, 'bandera');
  assert.equal(previewModeOf(bandera), '2D');
  assert.equal(bandera?.family, 'PLANAR');

  assert.equal(remera?.id, 'remera-cuello-redondo');
  assert.equal(previewModeOf(remera), '3D');
  assert.equal(remera?.moldId, 'remera-cuello-redondo');

  assert.ok(shortFutbol);
  assert.equal(shortFutbol.id, 'short-futbol');
  assert.equal(shortFutbol.name, 'Short de fútbol');
  assert.equal(previewModeOf(shortFutbol), '3D');
  assert.notEqual(shortFutbol.id, shortDeportivo?.id);
  assert.notEqual(shortFutbol.catalogKey, shortDeportivo?.catalogKey);
  assert.notEqual(shortFutbol.moldId, shortDeportivo?.moldId);
  assert.notEqual(shortFutbol.id, shortCiclismo?.id);
  assert.notEqual(shortFutbol.id, bermuda?.id);
});

test('library lists required differentiated garments and does not duplicate conjunto', () => {
  const names = listProductLibrary().map((p) => p.name);
  const required = [
    'Remera cuello redondo',
    'Remera manga corta',
    'Remera manga larga',
    'Chomba',
    'Musculosa deportiva',
    'Musculosa de gimnasio',
    'Remera de entrenamiento',
    'Camiseta deportiva',
    'Camiseta de fútbol',
    'Camiseta de básquet',
    'Camiseta de vóley',
    'Camiseta de running',
    'Camiseta de ciclismo',
    'Calza deportiva',
    'Calza de ciclismo',
    'Short deportivo',
    'Short de fútbol',
    'Short de ciclismo',
    'Bermuda deportiva',
    'Conjunto deportivo',
    'Pechera deportiva',
    'Bandera',
    'Manta playera',
    'Cubrecama',
    'Cubremaletas',
    'Tiras',
  ];
  for (const name of required) {
    assert.ok(names.includes(name), `missing ${name}`);
  }
  assert.equal(names.filter((n) => n === 'Conjunto deportivo').length, 1);
  assert.equal(names.includes('Set deportivo'), false);
  const conjunto = resolveProduct({ name: 'Set deportivo' });
  assert.equal(conjunto?.id, 'conjunto-deportivo');
  assert.equal(conjunto?.catalogKey, 'set-deportivo');
  assert.equal(PRODUCT_NAME_NORMALIZATIONS[0]?.to, 'Conjunto deportivo');
});

test('previewMode defaults to 2D and 3D is never implied', () => {
  assert.equal(previewModeOf(undefined), '2D');
  assert.equal(previewModeOf(getProductById('tiras')), '2D');
  assert.equal(previewModeOf(getProductById('panos')), '2D');
  assert.equal(previewModeOf(getProductById('short-futbol')), '3D');
});

test('visual version changes invalidate a previous approval fingerprint', () => {
  const form = {
    previewApproved: true,
    previewMode: '3D' as const,
    productKey: 'remera-cuello-redondo',
    designFileId: 'd1',
    ojoSession: {
      sample2dFileId: 's1',
      hints: [],
      current: { fileId: 's1' },
      region: { shape: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    },
    preview3dDecision: { status: 'APPROVED', visualVersion: '' },
  };
  const a = visualVersionFromForm(form);
  form.preview3dDecision = { status: 'APPROVED', visualVersion: a };
  assert.equal(approvalMatchesVisual(form).valid, true);
  form.ojoSession = { ...form.ojoSession, sample2dFileId: 's2', current: { fileId: 's2' } };
  assert.equal(visualVersionFromForm(form) !== a, true);
  assert.equal(approvalMatchesVisual(form).valid, false);
});
