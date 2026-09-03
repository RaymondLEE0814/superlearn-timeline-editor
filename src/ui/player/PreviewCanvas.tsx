import { useEffect, useRef } from 'react';
import type { Ctx2D } from '../../engine/render/ctx';
import { buildRenderGraph } from '../../engine/render/graph';
import { formatTimecode } from '../../engine/timebase';
import { useEditorStore } from '../../store/editorStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { useRequiredSession } from '../servicesContext';

/**
 * 프리뷰 캔버스.
 * 매 프레임 React 를 다시 그리면 60fps 를 못 내므로 rAF 루프에서 직접 캔버스에 그린다.
 * e2e 가 프레임 정확도를 확인할 수 있도록 data 속성에 현재 값을 남긴다.
 */
export function PreviewCanvas() {
  const session = useRequiredSession();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let lastHash = '';
    let lastSize = '';

    const draw = () => {
      const timeline = useEditorStore.getState().timeline;
      const frame = usePlaybackStore.getState().frame;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = wrap.clientWidth;
      const cssH = Math.round((cssW * 9) / 16);
      const sizeKey = `${cssW}x${cssH}x${dpr}`;
      if (sizeKey !== lastSize) {
        lastSize = sizeKey;
        canvas.width = Math.max(2, Math.round(cssW * dpr));
        canvas.height = Math.max(2, Math.round(cssH * dpr));
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        lastHash = '';
      }

      if (!timeline) {
        ctx.fillStyle = '#111113';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        raf = requestAnimationFrame(draw);
        return;
      }

      const comp = buildRenderGraph(timeline, frame);
      // 변화가 없으면 다시 그리지 않는다.
      if (comp.hash !== lastHash) {
        lastHash = comp.hash;
        session.compositor.render(comp, ctx as unknown as Ctx2D, {
          w: canvas.width,
          h: canvas.height,
        });
        session.mixer.apply(comp);

        const videoLayer = comp.layers.find((l) => l.kind === 'video');
        canvas.dataset.frame = String(frame);
        canvas.dataset.sourceFrame =
          videoLayer && videoLayer.kind === 'video' ? String(videoLayer.sourceFrame) : '';
        canvas.dataset.tc = formatTimecode(frame, timeline.fps);
        canvas.dataset.gap = String(comp.layers[0]?.kind === 'gap');
      }
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [session]);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas
        ref={canvasRef}
        data-testid="preview-canvas"
        className="block w-full cursor-pointer rounded bg-black"
        onClick={() => {
          void session.mixer.ensureStarted();
          session.clock.toggle();
        }}
      />
    </div>
  );
}
