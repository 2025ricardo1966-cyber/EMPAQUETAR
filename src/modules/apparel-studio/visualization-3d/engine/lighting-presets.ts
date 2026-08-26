import * as THREE from 'three';
import type { LightingPresetId } from '../types';

export interface LightingPreset {
  id: LightingPresetId;
  label: string;
  ambient: number;
  key: { intensity: number; position: [number, number, number] };
  fill: { intensity: number; position: [number, number, number] };
  rim: { intensity: number; position: [number, number, number] };
}

export const LIGHTING_PRESETS: Record<LightingPresetId, LightingPreset> = {
  studio: {
    id: 'studio',
    label: 'Estudio',
    ambient: 0.42,
    key: { intensity: 1.05, position: [2.5, 3.5, 2.8] },
    fill: { intensity: 0.45, position: [-2.2, 1.8, 2.4] },
    rim: { intensity: 0.55, position: [0, 2.5, -3.2] },
  },
  soft: {
    id: 'soft',
    label: 'Suave',
    ambient: 0.58,
    key: { intensity: 0.72, position: [1.8, 2.8, 2.2] },
    fill: { intensity: 0.55, position: [-1.6, 1.2, 2.0] },
    rim: { intensity: 0.25, position: [0, 2.0, -2.5] },
  },
  dramatic: {
    id: 'dramatic',
    label: 'Dramática',
    ambient: 0.22,
    key: { intensity: 1.35, position: [3.2, 4.0, 1.5] },
    fill: { intensity: 0.18, position: [-2.8, 0.5, 1.2] },
    rim: { intensity: 0.85, position: [-1.5, 2.8, -3.5] },
  },
  outdoor: {
    id: 'outdoor',
    label: 'Exterior',
    ambient: 0.48,
    key: { intensity: 1.15, position: [4.0, 6.0, 2.0] },
    fill: { intensity: 0.35, position: [-1.0, 2.0, 3.0] },
    rim: { intensity: 0.4, position: [0, 3.5, -4.0] },
  },
};

export function applyLightingPreset(
  scene: THREE.Scene,
  presetId: LightingPresetId,
  lights: {
    ambient: THREE.AmbientLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
  }
): void {
  const preset = LIGHTING_PRESETS[presetId];
  lights.ambient.intensity = preset.ambient;
  lights.key.intensity = preset.key.intensity;
  lights.key.position.set(...preset.key.position);
  lights.fill.intensity = preset.fill.intensity;
  lights.fill.position.set(...preset.fill.position);
  lights.rim.intensity = preset.rim.intensity;
  lights.rim.position.set(...preset.rim.position);

  scene.background = new THREE.Color(presetId === 'dramatic' ? 0x0a0c12 : 0x12151c);
}
