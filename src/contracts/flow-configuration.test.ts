import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultFlowConfiguration,
  flowFeatureEnabled,
  parseFlowConfiguration,
  presentClientFlow,
  resolveFlowActions,
} from './flow-configuration';
import { discoverWorkshopCapabilities } from './empaquetar-capabilities';

test('defaults enable every known capability and keep a stable action order', () => {
  const cfg = defaultFlowConfiguration('t1');
  assert.equal(cfg.features.length, 18);
  assert.equal(cfg.features.every((f) => f.enabled), true);
  assert.ok(cfg.features.some((f) => f.featureKey === 'orders'));
  assert.ok(cfg.features.some((f) => f.featureKey === 'preview'));
  assert.deepEqual(cfg.actionOrder, ['preview', 'download_2d', 'download_3d', 'continue_production']);
});

test('core capabilities cannot be disabled by tenant configuration', () => {
  const cfg = parseFlowConfiguration(
    {
      features: [
        { featureKey: 'orders', enabled: false },
        { featureKey: 'traceability', enabled: false },
      ],
    },
    't1'
  );
  assert.equal(flowFeatureEnabled(cfg, 'orders'), true);
  assert.equal(flowFeatureEnabled(cfg, 'traceability'), true);
});

test('unknown keys are ignored and missing keys fall back to defaults', () => {
  const cfg = parseFlowConfiguration(
    {
      features: [
        { featureKey: 'ojo', enabled: false },
        { featureKey: 'not-a-real-key', enabled: true },
      ],
      actionOrder: ['continue_production', 'bogus', 'download_2d', 'download_2d', 'preview'],
    },
    't1'
  );
  assert.equal(flowFeatureEnabled(cfg, 'ojo'), false);
  assert.equal(flowFeatureEnabled(cfg, 'download_2d'), true);
  assert.deepEqual(cfg.actionOrder, ['continue_production', 'download_2d', 'preview', 'download_3d']);
});

test('client presentation keys come from the discovered catalog', () => {
  const presented = presentClientFlow(defaultFlowConfiguration('t1'));
  assert.deepEqual(
    Object.keys(presented.features).sort(),
    discoverWorkshopCapabilities()
      .map((row) => row.key)
      .slice()
      .sort()
  );
});

test('download 3D stays hidden when preview 3D is off even if download 3D is enabled', () => {
  const cfg = parseFlowConfiguration(
    {
      features: [
        { featureKey: 'preview_3d', enabled: false },
        { featureKey: 'download_3d', enabled: true },
      ],
    },
    't1'
  );
  assert.equal(flowFeatureEnabled(cfg, 'download_3d'), false);
});

test('dependent OJO tools hide when OJO itself is off', () => {
  const cfg = parseFlowConfiguration({ features: [{ featureKey: 'ojo', enabled: false }] }, 't1');
  assert.equal(flowFeatureEnabled(cfg, 'ojo_zone'), false);
  assert.equal(flowFeatureEnabled(cfg, 'ojo_rect'), false);
  assert.equal(flowFeatureEnabled(cfg, 'ojo_hint'), false);
  const presented = presentClientFlow(cfg);
  assert.equal(presented.features.ojo, false);
  assert.equal(presented.features.ojo_zone, false);
});

test('download 3D is not shown without a valid 3D preview even if the feature is on', () => {
  const presented = presentClientFlow(defaultFlowConfiguration('t1'));
  const hidden = resolveFlowActions(presented, { previewMode: '2D', sample3dAvailable: false });
  assert.equal(hidden.find((a) => a.key === 'download_3d')?.visible, false);
  const shown = resolveFlowActions(presented, { previewMode: '3D', sample3dAvailable: true });
  assert.equal(shown.find((a) => a.key === 'download_3d')?.visible, true);
});

test('action order is presentation-only and continue stays independently togglable', () => {
  const cfg = parseFlowConfiguration(
    {
      features: [{ featureKey: 'continue_production', enabled: false }],
      actionOrder: ['continue_production', 'preview', 'download_3d', 'download_2d'],
    },
    't1'
  );
  const actions = resolveFlowActions(presentClientFlow(cfg), { previewMode: '3D', sample3dAvailable: true });
  assert.deepEqual(
    actions.map((a) => a.key),
    ['continue_production', 'preview', 'download_3d', 'download_2d']
  );
  assert.equal(actions.find((a) => a.key === 'continue_production')?.visible, false);
  assert.equal(actions.find((a) => a.key === 'preview')?.visible, true);
});
