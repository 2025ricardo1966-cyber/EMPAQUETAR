import React from 'react';
import { resolveUniversalMoldeWithOptions } from '../../../modules/apparel-studio/moldes/engine/molde-options-engine';
import type { CollarId, FabricId, SleeveId, Talle } from '../../../modules/apparel-studio/moldes/types';
import { Garment3DViewer } from '../../modules/apparel/Garment3DViewer';
import { useI18n } from '../providers/I18nProvider';

type DesignLayer = {
  zone?: string;
  scale?: number;
  orientation?: string;
  proportion?: { width: number; height: number; ratio: number } | null;
  designType?: string;
} | null;

type ViewerParams = {
  ready?: boolean;
  pendingReasons?: string[];
  moldId?: string;
  talle?: string;
  categoria?: 'adulto' | 'infantil';
  fabricId?: string;
  collarId?: string;
  sleeveId?: string;
  previewMode?: '2D' | '3D';
  productKey?: string;
  appliedDesignFileId?: string;
  designLayer?: DesignLayer;
};

export const ClientOrderPreview2D: React.FC<{
  designUrl?: string;
  proportion?: { width: number; height: number; ratio: number } | null;
}> = ({ designUrl, proportion }) => {
  const ratio = proportion?.ratio && proportion.ratio > 0 ? proportion.ratio : undefined;
  return (
    <div data-order-preview="2d" data-preview-mode="2D">
      {designUrl ? (
        <div
          style={{
            width: '100%',
            maxWidth: 640,
            aspectRatio: ratio ? String(ratio) : undefined,
            background: '#f4f4f4',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <img
            src={designUrl}
            alt="muestra 2d"
            data-role="design-applied"
            style={{
              width: '100%',
              height: '100%',
              maxHeight: 480,
              objectFit: 'contain',
              objectPosition: 'center',
              display: 'block',
              boxShadow: 'none',
              filter: 'none',
              transform: 'none',
            }}
          />
        </div>
      ) : (
        <p>Sin diseño aplicado.</p>
      )}
    </div>
  );
};

export const ClientOrderPreview3D: React.FC<{
  designUrl?: string;
  viewer?: ViewerParams | null;
}> = ({ designUrl, viewer }) => {
  const { t } = useI18n();
  const resolved = React.useMemo(() => {
    if (!viewer?.ready || !viewer.moldId || !viewer.talle) return null;
    return resolveUniversalMoldeWithOptions(
      viewer.moldId,
      viewer.categoria || 'adulto',
      viewer.talle as Talle,
      [],
      [],
      [],
      [],
      {
        collarId: viewer.collarId as CollarId | undefined,
        sleeveId: viewer.sleeveId as SleeveId | undefined,
      }
    );
  }, [viewer]);
  const valid3d = !!(resolved && viewer?.moldId);
  return (
    <div data-order-preview="3d" data-preview-mode="3D">
      {viewer && !viewer.ready ? (
        <p data-role="preview-pending">
          {t('flow.preview_pending')}
          {viewer.pendingReasons?.length ? ` (${viewer.pendingReasons.join(', ')})` : ''}
        </p>
      ) : null}
      {valid3d ? (
        <Garment3DViewer
          moldId={viewer!.moldId!}
          piezas={resolved!.piezas}
          fabricId={(viewer?.fabricId as FabricId) || 'dry-fit'}
          height={320}
          designUrl={designUrl}
          designLayer={
            viewer?.designLayer
              ? {
                  zone: viewer.designLayer.zone || 'front',
                  scale: viewer.designLayer.scale ?? 1,
                  orientation: viewer.designLayer.orientation || 'upright',
                  proportion: viewer.designLayer.proportion || null,
                  designType: viewer.designLayer.designType || 'unknown',
                }
              : null
          }
          validationMode
        />
      ) : viewer?.ready ? (
        <p>Vista 3D no disponible para esta prenda.</p>
      ) : null}
    </div>
  );
};

export const ClientOrderPreviewAdaptive: React.FC<{
  designUrl?: string;
  viewer?: ViewerParams | null;
}> = ({ designUrl, viewer }) => {
  const mode = viewer?.previewMode === '3D' ? '3D' : '2D';
  if (mode === '3D') {
    return <ClientOrderPreview3D designUrl={designUrl} viewer={viewer} />;
  }
  return (
    <ClientOrderPreview2D
      designUrl={designUrl}
      proportion={viewer?.designLayer?.proportion || null}
    />
  );
};
