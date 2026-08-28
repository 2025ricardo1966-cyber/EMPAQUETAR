import React, { useMemo } from 'react';
import { resolveUniversalMoldeWithOptions } from '../../../modules/apparel-studio/moldes/engine/molde-options-engine';
import type { CollarId, FabricId, SleeveId, Talle } from '../../../modules/apparel-studio/moldes/types';
import { Garment3DViewer } from '../../modules/apparel/Garment3DViewer';
import { useI18n } from '../providers/I18nProvider';

type ViewerParams = {
  ready?: boolean;
  pendingReasons?: string[];
  moldId?: string;
  talle?: string;
  categoria?: 'adulto' | 'infantil';
  fabricId?: string;
  collarId?: string;
  sleeveId?: string;
  designLayer?: {
    zone: string;
    scale: number;
    orientation: string;
    proportion: { width: number; height: number; ratio: number } | null;
    designType: string;
  } | null;
};

export const ClientOrderPreview3D: React.FC<{
  designUrl?: string;
  viewer?: ViewerParams | null;
}> = ({ designUrl, viewer }) => {
  const { t } = useI18n();
  const resolved = useMemo(() => {
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
  return (
    <div data-order-preview="3d">
      {designUrl ? (
        <p>
          <img src={designUrl} alt="diseño" style={{ maxWidth: 240, maxHeight: 240 }} />
        </p>
      ) : null}
      {viewer && !viewer.ready ? (
        <p data-role="preview-pending">
          {t('flow.preview_pending')}
          {viewer.pendingReasons?.length ? ` (${viewer.pendingReasons.join(', ')})` : ''}
        </p>
      ) : null}
      {resolved && viewer?.moldId ? (
        <Garment3DViewer
          moldId={viewer.moldId}
          piezas={resolved.piezas}
          fabricId={(viewer.fabricId as FabricId) || 'dry-fit'}
          height={320}
          designUrl={designUrl}
          designLayer={viewer.designLayer}
        />
      ) : viewer?.ready ? (
        <p>Vista 3D no disponible para esta prenda.</p>
      ) : null}
    </div>
  );
};
