import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { OjoRegion, OjoRegionShape } from '../../../contracts/visual-interpreter';

type Props = {
  imageUrl: string;
  value?: OjoRegion | null;
  onChange: (region: OjoRegion) => void;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export const OjoZoneMark: React.FC<Props> = ({ imageUrl, value, onChange }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [shape, setShape] = useState<OjoRegionShape>(value?.shape || 'rect');
  const [draft, setDraft] = useState<OjoRegion | null>(value || null);
  const drag = useRef<{ x0: number; y0: number; active: boolean } | null>(null);

  useEffect(() => {
    if (value) setDraft(value);
  }, [value]);

  const toNorm = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const box = img.getBoundingClientRect();
    const relX = (clientX - box.left) / box.width;
    const relY = (clientY - box.top) / box.height;
    return { x: clamp(relX, 0, 1), y: clamp(relY, 0, 1) };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x0: p.x, y0: p.y, active: true };
    setDraft({ shape, x: p.x, y: p.y, w: 0.001, h: 0.001 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current?.active) return;
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    const x = Math.min(drag.current.x0, p.x);
    const y = Math.min(drag.current.y0, p.y);
    const w = Math.abs(p.x - drag.current.x0);
    const h = Math.abs(p.y - drag.current.y0);
    setDraft({ shape, x, y, w: Math.max(w, 0.001), h: Math.max(h, 0.001) });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current?.active) return;
    drag.current.active = false;
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    const x = Math.min(drag.current.x0, p.x);
    const y = Math.min(drag.current.y0, p.y);
    const w = Math.max(Math.abs(p.x - drag.current.x0), 0.001);
    const h = Math.max(Math.abs(p.y - drag.current.y0), 0.001);
    const region: OjoRegion = { shape, x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
    setDraft(region);
    onChange(region);
  };

  const region = draft;
  return (
    <div data-ojo="zone" ref={wrapRef}>
      <p data-ojo="prompt">MARQUE LA ZONA QUE DESEA INTERPRETAR</p>
      <div data-ojo="tools">
        <button
          type="button"
          aria-pressed={shape === 'rect'}
          data-ojo-tool="rect"
          onClick={() => setShape('rect')}
        >
          Marco rectangular
        </button>
        <button
          type="button"
          aria-pressed={shape === 'ellipse'}
          data-ojo-tool="ellipse"
          onClick={() => setShape('ellipse')}
        >
          Marco elíptico
        </button>
      </div>
      <div
        data-ojo="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img ref={imgRef} src={imageUrl} alt="" draggable={false} />
        {region ? (
          <svg data-ojo="overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
            {region.shape === 'ellipse' ? (
              <ellipse
                cx={region.x + region.w / 2}
                cy={region.y + region.h / 2}
                rx={region.w / 2}
                ry={region.h / 2}
              />
            ) : (
              <rect x={region.x} y={region.y} width={region.w} height={region.h} />
            )}
          </svg>
        ) : null}
      </div>
    </div>
  );
};
