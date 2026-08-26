import * as THREE from 'three';
import type { FabricProperties } from '../../moldes/types';
import type { Garment3DSimulationOptions } from '../types';

export interface SimulatableMeshPart {
  mesh: THREE.Mesh;
  basePositions: Float32Array;
}

export function captureBasePositions(geometry: THREE.BufferGeometry): Float32Array {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  return new Float32Array(pos.array);
}

/** Simulación procedural de tela: caída, pliegues y movimiento */
export function applyFabricSimulation(
  parts: SimulatableMeshPart[],
  fabric: FabricProperties,
  options: Garment3DSimulationOptions,
  time: number,
  bodyHeight: number
): void {
  if (!options.enabled) {
    resetToBase(parts);
    return;
  }

  const drape = fabric.caida / 100;
  const thickness = fabric.espesor / 100;
  const elasticity = fabric.elasticidad / 100;
  const foldAmp = thickness * 0.032 * (1 - elasticity * 0.45);
  const moveAmp = options.movement ? drape * 0.018 : 0;

  for (const part of parts) {
    const pos = part.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const base = part.basePositions;

    for (let i = 0; i < pos.count; i += 1) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const bz = base[i * 3 + 2];

      const heightNorm = THREE.MathUtils.clamp((by + bodyHeight * 0.5) / bodyHeight, 0, 1);
      let dz = -drape * 0.06 * (1 - heightNorm) ** 2;

      if (options.folds) {
        dz +=
          Math.sin(bx * 14 + time * 0.9) *
          Math.cos(by * 10 + time * 0.55) *
          foldAmp *
          (0.35 + heightNorm * 0.65);
        dz +=
          Math.sin(bx * 7 - by * 5 + time * 0.35) *
          foldAmp *
          0.45 *
          (1 - heightNorm);
      }

      if (moveAmp > 0) {
        dz += Math.sin(time * 1.15 + bx * 5 + by * 2) * moveAmp;
        const dx = Math.sin(time * 0.85 + by * 3) * moveAmp * 0.35;
        pos.setXYZ(i, bx + dx, by, bz + dz);
      } else {
        pos.setXYZ(i, bx, by, bz + dz);
      }
    }

    pos.needsUpdate = true;
    part.mesh.geometry.computeVertexNormals();
  }
}

export function resetToBase(parts: SimulatableMeshPart[]): void {
  for (const part of parts) {
    const pos = part.mesh.geometry.attributes.position as THREE.BufferAttribute;
    pos.array.set(part.basePositions);
    pos.needsUpdate = true;
    part.mesh.geometry.computeVertexNormals();
  }
}
