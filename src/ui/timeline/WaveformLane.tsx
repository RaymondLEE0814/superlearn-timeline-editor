import { useEffect, useRef } from 'react';
import { downsamplePeaks, resolveWaveform } from '../../engine/metadata/waveform';
import { fpsToNumber } from '../../engine/timebase';
import { clipEnd } from '../../engine/timeline/model';
import type { MediaMetadata, Timeline } from '../../engine/types';
import { pxPerFrame } from './geometry';

/**
 * 오디오 트랙 파형.
 * 클립마다 원본 소스의 해당 구간 피크를 잘라 그리므로 컷 편집 결과가 파형에도 그대로 보인다.
 */
export function WaveformLane({
  meta,
  timeline,
  zoom,
  height,
  totalPx,
}: {
  meta: MediaMetadata;
  timeline: Timeline;
  zoom: number;
  height: number;
  totalPx: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.min(totalPx, 16000));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);

    const peaks = resolveWaveform(meta);
    const fps = fpsToNumber(meta.stream.fps);
    const sps = meta.waveform.samplesPerSecond;
    const ppf = pxPerFrame(meta.stream.fps, zoom);
    const audio = timeline.tracks.find((t) => t.kind === 'audio');
    if (!audio) return;

    ctx.fillStyle = '#9ca3af';
    for (const clip of audio.clips) {
      const x0 = clip.startFrame * ppf;
      const x1 = clipEnd(clip) * ppf;
      if (x1 < 0 || x0 > w) continue;
      const cw = Math.max(1, Math.round(x1 - x0));
      const a = Math.floor((clip.sourceInFrame / fps) * sps);
      const b = Math.min(peaks.length, Math.ceil((clip.sourceOutFrame / fps) * sps));
      if (b <= a) continue;
      const slice = peaks.subarray(a, b);
      const buckets = downsamplePeaks(slice, Math.max(1, Math.min(cw, 4000)));
      const step = cw / buckets.length;
      for (let i = 0; i < buckets.length; i += 1) {
        const amp = buckets[i] * (height / 2) * 0.92;
        ctx.fillRect(x0 + i * step, height / 2 - amp, Math.max(0.5, step), amp * 2);
      }
      // 게인 라인
      const gainNorm = Math.max(0, Math.min(1, ((clip.gain ?? 0) + 24) / 24));
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, height - gainNorm * height);
      ctx.lineTo(x1, height - gainNorm * height);
      ctx.stroke();
      ctx.fillStyle = '#9ca3af';
    }
  }, [meta, timeline, zoom, height, totalPx]);

  return <canvas ref={ref} className="pointer-events-none absolute top-0 left-0" />;
}
