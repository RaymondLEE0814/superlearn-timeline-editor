import type { MediaMetadata } from '../types';

/**
 * 파형 피크를 시드에서 결정적으로 생성한다.
 * 45분 강의의 피크 배열은 5만개가 넘어 fixture 에 넣으면 커지므로 런타임에 만든다.
 * 무음 구간과 어긋나면 자동 편집 점수가 왜곡되므로 silences 를 반영한다.
 */
export function resolveWaveform(meta: MediaMetadata): Float32Array {
  if (meta.waveform.peaks) return Float32Array.from(meta.waveform.peaks);

  const sps = meta.waveform.samplesPerSecond;
  const fps = meta.stream.fps.num / meta.stream.fps.den;
  const total = Math.max(1, Math.ceil((meta.stream.durationFrames / fps) * sps));
  const peaks = new Float32Array(total);

  // 무음 여부를 빠르게 판정하기 위한 샘플 인덱스 구간 목록
  const silentSpans = meta.silences.map((s) => [
    Math.floor((s.startFrame / fps) * sps),
    Math.ceil((s.endFrame / fps) * sps),
  ]);
  let si = 0;

  let a = (meta.waveform.seed || 1) >>> 0;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 0; i < total; i += 1) {
    while (si < silentSpans.length && silentSpans[si][1] <= i) si += 1;
    const inSilence = si < silentSpans.length && i >= silentSpans[si][0] && i < silentSpans[si][1];
    if (inSilence) {
      peaks[i] = 0.01 + rnd() * 0.03;
    } else {
      // 말소리처럼 보이도록 느린 포락선 + 빠른 변동을 섞는다.
      const env = 0.45 + 0.35 * Math.sin(i / 37) * Math.sin(i / 113);
      peaks[i] = Math.min(1, Math.max(0.05, env + (rnd() - 0.5) * 0.45));
    }
  }
  return peaks;
}

/** [startFrame, endFrame) 구간의 평균 에너지(0~1). */
export function averageEnergy(
  peaks: Float32Array,
  meta: MediaMetadata,
  startFrame: number,
  endFrame: number,
): number {
  const fps = meta.stream.fps.num / meta.stream.fps.den;
  const sps = meta.waveform.samplesPerSecond;
  const a = Math.max(0, Math.floor((startFrame / fps) * sps));
  const b = Math.min(peaks.length, Math.ceil((endFrame / fps) * sps));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += peaks[i];
  return sum / (b - a);
}

/** 타임라인 표시용 다운샘플. bucket 당 최대값을 취해 시각적 피크를 유지한다. */
export function downsamplePeaks(peaks: Float32Array, buckets: number): Float32Array {
  if (buckets >= peaks.length) return peaks;
  const out = new Float32Array(buckets);
  const per = peaks.length / buckets;
  for (let i = 0; i < buckets; i += 1) {
    const a = Math.floor(i * per);
    const b = Math.min(peaks.length, Math.floor((i + 1) * per));
    let max = 0;
    for (let j = a; j < b; j += 1) if (peaks[j] > max) max = peaks[j];
    out[i] = max;
  }
  return out;
}
