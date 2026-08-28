import React, { useEffect, useRef, useState } from 'react';
import type { FabricId, MedidasPiezaResueltas, MoldeId } from '../../../modules/apparel-studio/moldes/types';
import {
  DEFAULT_GARMENT_3D_CONFIG,
  Garment3DSceneController,
  VALIDATION_SIMULATION,
  type CameraViewPreset,
  type Garment3DSimulationOptions,
  type LightingPresetId,
} from '../../../modules/apparel-studio/visualization-3d';
import { Garment3DControls } from './Garment3DControls';

interface Garment3DViewerProps {
  moldId: MoldeId;
  piezas: MedidasPiezaResueltas[];
  fabricId?: FabricId;
  height?: number;
  className?: string;
  designUrl?: string;
  designLayer?: {
    zone: string;
    scale: number;
    orientation: string;
    proportion: { width: number; height: number; ratio: number } | null;
    designType: string;
  } | null;
  /** Product validation: real design, no cloth sim / cinematic FX. */
  validationMode?: boolean;
}

export const Garment3DViewer: React.FC<Garment3DViewerProps> = ({
  moldId,
  piezas,
  fabricId = 'dry-fit',
  height = 360,
  className = '',
  designUrl,
  designLayer,
  validationMode = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<Garment3DSceneController | null>(null);

  const [view, setView] = useState<CameraViewPreset>(DEFAULT_GARMENT_3D_CONFIG.view);
  const [zoom, setZoom] = useState(DEFAULT_GARMENT_3D_CONFIG.zoom);
  const [lighting, setLighting] = useState<LightingPresetId>(
    validationMode ? 'studio' : DEFAULT_GARMENT_3D_CONFIG.lighting
  );
  const [simulation, setSimulation] = useState<Garment3DSimulationOptions>(
    validationMode ? VALIDATION_SIMULATION : DEFAULT_GARMENT_3D_CONFIG.simulation
  );
  const [autoRotate, setAutoRotate] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const controller = new Garment3DSceneController(canvas, {
      moldId,
      piezas,
      fabricId,
      simulation: validationMode ? VALIDATION_SIMULATION : simulation,
      lighting,
      view,
      autoRotate: false,
      zoom,
      designLayer: designLayer || undefined,
      designUrl,
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; updates via separate effect
  }, []);

  useEffect(() => {
    controllerRef.current?.updateConfig({
      moldId,
      piezas,
      fabricId,
      simulation: validationMode ? VALIDATION_SIMULATION : simulation,
      lighting,
      view,
      autoRotate: validationMode ? false : autoRotate,
      zoom,
      designLayer: designLayer || undefined,
      designUrl,
    });
  }, [moldId, piezas, fabricId, simulation, lighting, view, autoRotate, zoom, designLayer, designUrl, validationMode]);

  const handleViewChange = (next: CameraViewPreset) => {
    setView(next);
    controllerRef.current?.setView(next, true);
  };

  const handleZoomChange = (next: number) => {
    setZoom(next);
    controllerRef.current?.setZoom(next);
  };

  return (
    <section className={`space-y-3 ${className}`}>
      <div
        className="overflow-hidden rounded-xl border border-hud-line bg-[#0d1016]"
        style={{ height }}
      >
        <canvas ref={canvasRef} className="h-full w-full touch-none" />
      </div>
      <Garment3DControls
        view={view}
        zoom={zoom}
        lighting={lighting}
        simulation={validationMode ? VALIDATION_SIMULATION : simulation}
        autoRotate={validationMode ? false : autoRotate}
        validationMode={validationMode}
        onViewChange={handleViewChange}
        onZoomChange={handleZoomChange}
        onLightingChange={setLighting}
        onSimulationChange={setSimulation}
        onAutoRotateChange={setAutoRotate}
      />
    </section>
  );
};
