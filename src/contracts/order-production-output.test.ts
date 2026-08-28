import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RequestInvalidError } from './configuration-schema';
import {
  assertCanGenerateOutputs,
  assertOrderCanGenerateOutputs,
  isProductionGateError,
  productionOutputGateInput,
} from './order-production-output';

function form(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selectedGarmentTypes: ['CAMISETA'],
    rosterIntake: { status: 'APPROVED' },
    productionRevision: { id: 'rev_1', version: 1 },
    designFileId: 'design-1',
    previewApproved: true,
    rawMaterialRequested: false,
    ...over,
  };
}

test('assertCanGenerateOutputs rejects preview pending without RAW', () => {
  assert.throws(
    () =>
      assertCanGenerateOutputs({
        rosterStatus: 'APPROVED',
        selectedGarmentTypes: ['CAMISETA'],
        productionRevisionId: 'rev_1',
        designFileId: 'd1',
        previewApproved: false,
        rawMaterial: false,
      }),
    (err: unknown) => err instanceof RequestInvalidError && err.message === 'REQUEST_INVALID:PREVIEW_PENDING'
  );
});

test('assertOrderCanGenerateOutputs allows approved preview', () => {
  assert.doesNotThrow(() => assertOrderCanGenerateOutputs(form()));
});

test('assertOrderCanGenerateOutputs allows RAW without preview', () => {
  assert.doesNotThrow(() =>
    assertOrderCanGenerateOutputs(form({ previewApproved: false, rawMaterialRequested: true }))
  );
});

test('productionOutputGateInput maps form values onto the shared predicate', () => {
  const input = productionOutputGateInput(
    form({ previewApproved: false, rawMaterialRequested: true, rosterIntake: { status: 'APPROVED' } })
  );
  assert.equal(input.rosterStatus, 'APPROVED');
  assert.deepEqual(input.selectedGarmentTypes, ['CAMISETA']);
  assert.equal(input.productionRevisionId, 'rev_1');
  assert.equal(input.designFileId, 'design-1');
  assert.equal(input.previewApproved, false);
  assert.equal(input.rawMaterial, true);
});

test('isProductionGateError recognizes PREVIEW_PENDING', () => {
  assert.equal(isProductionGateError(new RequestInvalidError('PREVIEW_PENDING')), true);
  assert.equal(isProductionGateError(new RequestInvalidError('OUTPUT_EMPTY')), false);
  assert.equal(isProductionGateError(new Error('nope')), false);
});
