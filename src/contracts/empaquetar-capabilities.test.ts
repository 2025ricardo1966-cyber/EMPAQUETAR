import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oraCapabilityCatalog } from './ora-core';
import {
  EMPAQUETAR_CAPABILITY_CATALOG,
  EMPAQUETAR_COMMERCIAL_TIERS,
  discoverWorkshopCapabilities,
  workshopCapabilityDefinition,
} from './empaquetar-capabilities';

test('workshop capabilities are discovered from the EMPAQUETAR catalog, not invented ad hoc', () => {
  const discovered = discoverWorkshopCapabilities();
  assert.equal(discovered.length, EMPAQUETAR_CAPABILITY_CATALOG.length);
  assert.equal(discovered.every((row) => row.supported && row.availability === 'supported'), true);
  assert.ok(discovered.some((row) => row.key === 'ojo'));
  assert.ok(discovered.some((row) => row.key === 'orders' && row.configurable === false));
  assert.ok(discovered.some((row) => row.key === 'traceability' && row.configurable === false));
  assert.equal(workshopCapabilityDefinition('not-a-real-capability'), undefined);
  assert.equal(workshopCapabilityDefinition('IMAGE_16K'), undefined);
});

test('ORA independent capabilities are not duplicated into the workshop flow catalog', () => {
  const workshopKeys = new Set(discoverWorkshopCapabilities().map((row) => row.key as string));
  const oraIds = oraCapabilityCatalog()
    .map((row) => row.id)
    .filter((id) => id !== 'EMPAQUETAR');
  for (const id of oraIds) {
    assert.equal(workshopKeys.has(id), false, id);
  }
});

test('commercial plan metadata exists but is unset (no paywall)', () => {
  assert.deepEqual(EMPAQUETAR_COMMERCIAL_TIERS, ['BASIC', 'INTERMEDIATE', 'ENTERPRISE']);
  for (const row of discoverWorkshopCapabilities()) {
    assert.equal(row.commercialTier, null);
    assert.equal(row.commercialPrice, null);
    assert.ok(row.commercialCategory);
  }
});
