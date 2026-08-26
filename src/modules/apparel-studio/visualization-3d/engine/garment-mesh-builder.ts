import * as THREE from 'three';
import type { FabricId } from '../../moldes/types';
import { getFabricDefinition } from '../../moldes/catalog/fabric-library';
import type { Garment3DMeasurements } from '../types';
import { captureBasePositions, type SimulatableMeshPart } from './fabric-simulation';

const CM = 0.014;

function fabricMaterial(fabricId: FabricId): THREE.MeshStandardMaterial {
  const def = getFabricDefinition(fabricId);
  const roughness = THREE.MathUtils.clamp(1 - def.propiedades.brillo / 120, 0.18, 0.92);
  const metalness = def.propiedades.brillo > 55 ? 0.08 : 0.02;
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(def.baseColor),
    roughness,
    metalness,
    side: THREE.DoubleSide,
  });
}

function bendPanelGeometry(
  geometry: THREE.PlaneGeometry,
  chestWidth: number,
  arc: number,
  zSign: number
): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const radius = chestWidth / (Math.PI * 0.92);

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = x / (chestWidth * 0.5);
    const angle = t * arc;
    const nx = Math.sin(angle) * radius;
    const nz = (Math.cos(angle) - 1) * radius * zSign;
    pos.setXYZ(i, nx, y, nz);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createTorsoPanel(
  width: number,
  height: number,
  arc: number,
  zSign: number,
  material: THREE.Material
): SimulatableMeshPart {
  const geometry = new THREE.PlaneGeometry(width, height, 36, 28);
  geometry.translate(0, -height * 0.08, 0);
  bendPanelGeometry(geometry, width, arc, zSign);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, basePositions: captureBasePositions(geometry) };
}

function createSleeve(
  head: number,
  cuff: number,
  length: number,
  side: -1 | 1,
  chestWidth: number,
  bodyHeight: number,
  material: THREE.Material
): SimulatableMeshPart {
  const geometry = new THREE.CylinderGeometry(
    head * 0.5 * CM,
    cuff * 0.5 * CM,
    length * CM,
    20,
    6,
    false
  );
  geometry.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(
    side * chestWidth * CM * 0.52,
    bodyHeight * CM * 0.22,
    0.02
  );
  mesh.rotation.z = side * 0.28;
  mesh.rotation.y = side * 0.12;
  mesh.castShadow = true;
  return { mesh, basePositions: captureBasePositions(geometry) };
}

function createLowerGarment(
  waist: number,
  length: number,
  material: THREE.Material
): SimulatableMeshPart {
  const w = waist * CM;
  const h = length * CM;
  const geometry = new THREE.PlaneGeometry(w, h, 28, 22);
  geometry.translate(0, -h * 0.45, 0);
  bendPanelGeometry(geometry, w, Math.PI * 0.38, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -0.08;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, basePositions: captureBasePositions(geometry) };
}

function createHood(material: THREE.Material, chestWidth: number, bodyHeight: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(chestWidth * CM * 0.38, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, bodyHeight * CM * 0.38, -chestWidth * CM * 0.08);
  mesh.rotation.x = -0.35;
  mesh.castShadow = true;
  return mesh;
}

export interface BuiltGarment3D {
  group: THREE.Group;
  simulatableParts: SimulatableMeshPart[];
  bodyHeight: number;
}

/** Construye malla paramétrica 3D a partir de medidas del molde */
export function buildGarment3DMesh(
  measurements: Garment3DMeasurements,
  fabricId: FabricId
): BuiltGarment3D {
  const group = new THREE.Group();
  const simulatableParts: SimulatableMeshPart[] = [];

  const chestW = measurements.chestWidth * CM;
  const bodyH = measurements.bodyHeight * CM;

  const frontMat = fabricMaterial(fabricId);
  const backMat = fabricMaterial(fabricId);
  backMat.color.offsetHSL(0, 0, -0.04);

  const front = createTorsoPanel(chestW, bodyH, Math.PI * 0.48, 1, frontMat);
  front.mesh.position.y = bodyH * 0.08;
  group.add(front.mesh);
  simulatableParts.push(front);

  const back = createTorsoPanel(chestW, bodyH * 1.02, Math.PI * 0.48, -1, backMat);
  back.mesh.position.y = bodyH * 0.08;
  group.add(back.mesh);
  simulatableParts.push(back);

  if (measurements.hasSleeves) {
    const sleeveMat = fabricMaterial(fabricId);
    sleeveMat.color.offsetHSL(0, 0, -0.02);
    const left = createSleeve(
      measurements.sleeveHead,
      measurements.sleeveCuff,
      measurements.sleeveLength,
      -1,
      measurements.chestWidth,
      measurements.bodyHeight,
      sleeveMat
    );
    const right = createSleeve(
      measurements.sleeveHead,
      measurements.sleeveCuff,
      measurements.sleeveLength,
      1,
      measurements.chestWidth,
      measurements.bodyHeight,
      sleeveMat.clone()
    );
    group.add(left.mesh, right.mesh);
    simulatableParts.push(left, right);
  }

  if (measurements.hasHood) {
    group.add(createHood(frontMat.clone(), measurements.chestWidth, measurements.bodyHeight));
  }

  if (measurements.hasLower) {
    const lowerMat = fabricMaterial(fabricId);
    lowerMat.color.offsetHSL(0, 0, -0.06);
    const lower = createLowerGarment(measurements.waistWidth, measurements.legLength, lowerMat);
    lower.mesh.position.y = -bodyH * 0.42;
    group.add(lower.mesh);
    simulatableParts.push(lower);
  }

  group.position.y = measurements.hasLower ? bodyH * 0.15 : 0;

  return {
    group,
    simulatableParts,
    bodyHeight: bodyH,
  };
}
