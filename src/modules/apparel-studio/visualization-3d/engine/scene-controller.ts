import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FabricId, MedidasPiezaResueltas, MoldeId } from '../../moldes/types';
import { getFabricDefinition } from '../../moldes/catalog/fabric-library';
import type { CameraViewPreset, Garment3DSceneConfig, LightingPresetId } from '../types';
import { CAMERA_PRESETS } from './camera-presets';
import { applyLightingPreset } from './lighting-presets';
import { extractGarment3DMeasurements } from './garment-measurements';
import { buildGarment3DMesh } from './garment-mesh-builder';
import { applyFabricSimulation, resetToBase, type SimulatableMeshPart } from './fabric-simulation';

export class Garment3DSceneController {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private garmentGroup: THREE.Group | null = null;
  private simulatableParts: SimulatableMeshPart[] = [];
  private bodyHeight = 1;
  private fabricId: FabricId = 'dry-fit';
  private animationId = 0;
  private clock = new THREE.Clock();
  private config: Garment3DSceneConfig;
  private lights: {
    ambient: THREE.AmbientLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
  };
  private resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement, initial: Garment3DSceneConfig) {
    this.config = initial;
    this.fabricId = initial.fabricId;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 6;
    this.controls.target.set(0, 0.32, 0);

    this.lights = {
      ambient: new THREE.AmbientLight(0xffffff, 0.45),
      key: new THREE.DirectionalLight(0xfff5eb, 1),
      fill: new THREE.DirectionalLight(0xcfe8ff, 0.4),
      rim: new THREE.DirectionalLight(0xffffff, 0.5),
    };
    this.lights.key.castShadow = true;
    this.lights.key.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.lights.ambient, this.lights.key, this.lights.fill, this.lights.rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x1a1f28, roughness: 0.95, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.rebuildGarment(initial.moldId, initial.piezas, initial.fabricId);
    this.setLighting(initial.lighting);
    this.setView(initial.view, false);
    this.setZoom(initial.zoom);
    this.controls.autoRotate = initial.autoRotate;
    this.controls.autoRotateSpeed = 1.2;

    this.resize(canvas.parentElement ?? canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize(canvas.parentElement ?? canvas));
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

    this.animate();
  }

  private resize(container: Element): void {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private rebuildGarment(moldId: MoldeId, piezas: MedidasPiezaResueltas[], fabricId: FabricId): void {
    if (this.garmentGroup) {
      this.scene.remove(this.garmentGroup);
      this.disposeGroup(this.garmentGroup);
    }

    const measurements = extractGarment3DMeasurements(moldId, piezas);
    const built = buildGarment3DMesh(measurements, fabricId);
    this.garmentGroup = built.group;
    this.simulatableParts = built.simulatableParts;
    this.bodyHeight = built.bodyHeight;
    this.fabricId = fabricId;
    this.scene.add(built.group);
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    const time = this.clock.getElapsedTime();
    const fabric = getFabricDefinition(this.fabricId).propiedades;

    if (this.config.simulation.enabled) {
      applyFabricSimulation(
        this.simulatableParts,
        fabric,
        this.config.simulation,
        time,
        this.bodyHeight
      );
    } else {
      resetToBase(this.simulatableParts);
    }

    this.controls.autoRotate = this.config.autoRotate;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  updateConfig(next: Partial<Garment3DSceneConfig>): void {
    const prev = this.config;
    this.config = { ...this.config, ...next };
    // designLayer is retained for a later texture/layer pass; V1 does not bind a map.

    if (next.moldId || next.piezas || next.fabricId) {
      const moldId = next.moldId ?? prev.moldId;
      const piezas = next.piezas ?? prev.piezas;
      const fabricId = next.fabricId ?? prev.fabricId;
      if (
        moldId !== prev.moldId ||
        piezas !== prev.piezas ||
        fabricId !== prev.fabricId
      ) {
        this.rebuildGarment(moldId, piezas, fabricId);
      }
    }

    if (next.lighting) this.setLighting(next.lighting);
    if (next.view) this.setView(next.view, true);
    if (next.zoom !== undefined) this.setZoom(next.zoom);
  }

  setView(preset: CameraViewPreset, animate = true): void {
    const view = CAMERA_PRESETS[preset];
    const target = new THREE.Vector3(...view.target);
    const desired = new THREE.Vector3(...view.position);

    if (!animate) {
      this.camera.position.copy(desired);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }

    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = 450;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - (1 - t) ** 3;
      this.camera.position.lerpVectors(startPos, desired, ease);
      this.controls.target.lerpVectors(startTarget, target, ease);
      this.controls.update();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  setZoom(factor: number): void {
    const distance = THREE.MathUtils.lerp(3.8, 1.15, THREE.MathUtils.clamp(factor, 0, 1));
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.lengthSq() < 1e-6) {
      offset.set(0, 0.2, 2.2);
    }
    offset.normalize().multiplyScalar(distance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  setLighting(presetId: LightingPresetId): void {
    applyLightingPreset(this.scene, presetId, this.lights);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    if (this.garmentGroup) this.disposeGroup(this.garmentGroup);
    this.renderer.dispose();
  }
}
