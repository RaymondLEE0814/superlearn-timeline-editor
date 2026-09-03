import { formatTimecode } from '../timebase';
import type { VideoSource } from '../playback/sources';
import type { Fps, FrameComposition, Id, SubtitleStyle } from '../types';
import type { Ctx2D, DrawSize } from './ctx';

export interface CompositorDeps {
  sources: Map<Id, VideoSource>;
  fps: Fps;
  /** 오버레이 이미지 대신 그릴 플레이스홀더 라벨 해석기 */
  resolveOverlayLabel?: (imageRef: string) => string;
}

function wrapText(ctx: Ctx2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && line && lines[maxLines - 1] !== line) {
    lines[maxLines - 1] = `${lines[maxLines - 1]}…`;
  }
  return lines;
}

function drawSubtitle(ctx: Ctx2D, text: string, style: SubtitleStyle, size: DrawSize): void {
  const fontPx = Math.round((style.fontSizePx / 1080) * size.h);
  ctx.save();
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = style.align === 'center' ? 'center' : 'left';

  const maxWidth = size.w * 0.86;
  const lines = wrapText(ctx, text, maxWidth, 2);
  const lineH = fontPx * 1.35;
  const blockH = lines.length * lineH;
  // 세이프 에어리어: 하단 8%
  const safe = size.h * 0.08;
  const top = style.position === 'bottom' ? size.h - safe - blockH : safe;

  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  const boxW = Math.min(maxWidth, widest) + fontPx * 0.9;
  const boxX = style.align === 'center' ? (size.w - boxW) / 2 : size.w * 0.07;
  ctx.fillStyle = style.background;
  ctx.fillRect(boxX, top - fontPx * 0.3, boxW, blockH + fontPx * 0.6);

  ctx.fillStyle = style.color;
  lines.forEach((l, i) => {
    const x = style.align === 'center' ? size.w / 2 : boxX + fontPx * 0.45;
    ctx.fillText(l, x, top + lineH * i + lineH / 2);
  });
  ctx.restore();
}

function drawOverlayPlaceholder(
  ctx: Ctx2D,
  label: string,
  kind: string,
  rect: { x: number; y: number; w: number; h: number },
  opacity: number,
  size: DrawSize,
): void {
  const x = rect.x * size.w;
  const y = rect.y * size.h;
  const w = rect.w * size.w;
  const h = rect.h * size.h;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = 'rgba(250,250,250,0.95)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#FF3B30';
  ctx.lineWidth = Math.max(1, size.h * 0.003);
  ctx.strokeRect(x, y, w, h);

  const fontPx = Math.round(h * 0.13);
  ctx.fillStyle = '#FF3B30';
  ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(kind.toUpperCase(), x + w * 0.06, y + h * 0.08);

  ctx.fillStyle = '#333333';
  ctx.font = `${Math.round(h * 0.11)}px system-ui, sans-serif`;
  const lines = wrapText(ctx, label, w * 0.88, 3);
  lines.forEach((l, i) => {
    ctx.fillText(l, x + w * 0.06, y + h * 0.3 + i * h * 0.16);
  });
  ctx.restore();
}

/** 편집 결과 한 프레임을 캔버스에 합성한다. 프리뷰와 내보내기가 같은 코드를 쓴다. */
export class Compositor {
  constructor(private deps: CompositorDeps) {}

  render(comp: FrameComposition, ctx: Ctx2D, size?: DrawSize): void {
    const s = size ?? comp.size;
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, s.w, s.h);

    for (const layer of comp.layers) {
      switch (layer.kind) {
        case 'gap': {
          ctx.fillStyle = '#0f0f10';
          ctx.fillRect(0, 0, s.w, s.h);
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.font = `bold ${Math.round(s.h * 0.09)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('GAP', s.w / 2, s.h / 2);
          break;
        }
        case 'video': {
          const source = this.deps.sources.get(layer.sourceId);
          if (source) {
            ctx.save();
            ctx.globalAlpha = layer.opacity;
            source.draw(ctx, layer.sourceFrame, s);
            ctx.restore();
          } else {
            // 소스 로드 실패 시에도 화면은 유지한다.
            ctx.fillStyle = '#3a3a3c';
            ctx.fillRect(0, 0, s.w, s.h);
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = `${Math.round(s.h * 0.05)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`소스 없음: ${layer.sourceId}`, s.w / 2, s.h / 2);
          }
          break;
        }
        case 'overlay': {
          const label = this.deps.resolveOverlayLabel?.(layer.imageRef) ?? layer.imageRef;
          drawOverlayPlaceholder(ctx, label, layer.overlayKind, layer.rect, layer.opacity, s);
          break;
        }
        case 'subtitle':
          drawSubtitle(ctx, layer.text, layer.style, s);
          break;
      }
    }

    // 하단 우: 타임라인 타임코드
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `${Math.round(s.h * 0.035)}px ui-monospace, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`TL ${formatTimecode(comp.frame, this.deps.fps)}`, s.w * 0.94, s.h * 0.85);
    ctx.restore();
  }
}
