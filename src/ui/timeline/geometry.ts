import { fpsToNumber } from '../../engine/timebase';
import type { Fps, Frame } from '../../engine/types';

/** 줌 1 배에서 1초는 20px. */
export const BASE_PX_PER_SEC = 20;

export function pxPerFrame(fps: Fps, zoom: number): number {
  return (BASE_PX_PER_SEC * zoom) / fpsToNumber(fps);
}

export function frameToPx(frame: Frame, fps: Fps, zoom: number): number {
  return frame * pxPerFrame(fps, zoom);
}

export function pxToFrame(px: number, fps: Fps, zoom: number): Frame {
  return Math.round(px / pxPerFrame(fps, zoom));
}

/** 줌 수준에 맞는 눈금 간격(초). 라벨이 겹치지 않을 만큼 성기게 고른다. */
export function tickStepSec(zoom: number): number {
  const pxPerSec = BASE_PX_PER_SEC * zoom;
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  for (const c of candidates) if (c * pxPerSec >= 70) return c;
  return 3600;
}

export interface Viewport {
  startFrame: Frame;
  endFrame: Frame;
  widthPx: number;
}

export function visibleRange(
  scrollLeftPx: number,
  widthPx: number,
  fps: Fps,
  zoom: number,
  durationFrames: Frame,
): Viewport {
  const ppf = pxPerFrame(fps, zoom);
  const start = Math.max(0, Math.floor(scrollLeftPx / ppf) - 1);
  const end = Math.min(durationFrames + 1, Math.ceil((scrollLeftPx + widthPx) / ppf) + 1);
  return { startFrame: start, endFrame: end, widthPx };
}
