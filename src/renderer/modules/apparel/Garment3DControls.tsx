import React from 'react';
import type {
  CameraViewPreset,
  Garment3DSimulationOptions,
  LightingPresetId,
} from '../../../modules/apparel-studio/visualization-3d/types';
import {
  CAMERA_PRESETS,
  CAMERA_VIEW_ORDER,
  LIGHTING_PRESETS,
} from '../../../modules/apparel-studio/visualization-3d';

interface Garment3DControlsProps {
  view: CameraViewPreset;
  zoom: number;
  lighting: LightingPresetId;
  simulation: Garment3DSimulationOptions;
  autoRotate: boolean;
  onViewChange: (view: CameraViewPreset) => void;
  onZoomChange: (zoom: number) => void;
  onLightingChange: (lighting: LightingPresetId) => void;
  onSimulationChange: (simulation: Garment3DSimulationOptions) => void;
  onAutoRotateChange: (autoRotate: boolean) => void;
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-ui-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-hud-lineMuted"
      />
      {label}
    </label>
  );
}

export const Garment3DControls: React.FC<Garment3DControlsProps> = ({
  view,
  zoom,
  lighting,
  simulation,
  autoRotate,
  onViewChange,
  onZoomChange,
  onLightingChange,
  onSimulationChange,
  onAutoRotateChange,
}) => {
  const patchSim = (partial: Partial<Garment3DSimulationOptions>) =>
    onSimulationChange({ ...simulation, ...partial });

  return (
    <div className="space-y-3 rounded-xl border border-hud-line bg-surface-wash/10 p-3">
      <div>
        <p className="mb-2 text-[11px] uppercase tracking-wider text-ui-muted">Vistas</p>
        <div className="flex flex-wrap gap-1.5">
          {CAMERA_VIEW_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onViewChange(id)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                view === id
                  ? 'border-sky-400/50 bg-sky-400/10 text-sky-300'
                  : 'border-hud-lineMuted text-ui-muted hover:border-sky-400/30'
              }`}
            >
              {CAMERA_PRESETS[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-ui-muted">Zoom</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={zoom}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            className="w-full accent-sky-400"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-ui-muted">Iluminación</span>
          <select
            value={lighting}
            onChange={(e) => onLightingChange(e.target.value as LightingPresetId)}
            className="w-full rounded-lg border border-hud-lineMuted bg-surface-wash/30 px-2 py-1 text-xs text-ui-secondary"
          >
            {Object.values(LIGHTING_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="mb-2 text-[11px] uppercase tracking-wider text-ui-muted">
          Simulación de tela
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Toggle
            label="Simulación"
            checked={simulation.enabled}
            onChange={(enabled) => patchSim({ enabled })}
          />
          <Toggle
            label="Pliegues"
            checked={simulation.folds}
            onChange={(folds) => patchSim({ folds })}
          />
          <Toggle
            label="Movimiento"
            checked={simulation.movement}
            onChange={(movement) => patchSim({ movement })}
          />
          <Toggle
            label="Rotación libre"
            checked={autoRotate}
            onChange={onAutoRotateChange}
          />
        </div>
        <p className="mt-2 text-[10px] text-ui-subtle">
          Arrastrá con el mouse para rotar · rueda para zoom · caída y pliegues según la tela activa
        </p>
      </div>
    </div>
  );
};
