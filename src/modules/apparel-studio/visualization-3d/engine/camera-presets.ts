import type { CameraViewPreset } from '../types';

export interface CameraPreset {
  position: [number, number, number];
  target: [number, number, number];
  label: string;
}

export const CAMERA_PRESETS: Record<CameraViewPreset, CameraPreset> = {
  front: {
    position: [0, 0.38, 2.35],
    target: [0, 0.32, 0],
    label: 'Frontal',
  },
  back: {
    position: [0, 0.38, -2.35],
    target: [0, 0.32, 0],
    label: 'Posterior',
  },
  left: {
    position: [-2.35, 0.38, 0],
    target: [0, 0.32, 0],
    label: 'Lateral izq.',
  },
  right: {
    position: [2.35, 0.38, 0],
    target: [0, 0.32, 0],
    label: 'Lateral der.',
  },
  perspective: {
    position: [1.65, 1.05, 2.05],
    target: [0, 0.28, 0],
    label: 'Perspectiva',
  },
};

export const CAMERA_VIEW_ORDER: CameraViewPreset[] = [
  'front',
  'back',
  'left',
  'right',
  'perspective',
];
