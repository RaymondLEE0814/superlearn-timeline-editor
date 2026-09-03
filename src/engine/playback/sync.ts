import { clipAt, clipsInRange } from '../timeline/query';
import type { Clip, Frame, Timeline } from '../types';

export interface Presentation {
  frame: Frame;
  videoClip: Clip | null;
  /** 영상 클립의 소스 프레임. 갭이면 null. */
  sourceFrame: Frame | null;
  audioClips: Clip[];
  subtitleClips: Clip[];
  overlayClips: Clip[];
  isGap: boolean;
}

/** solo 가 하나라도 켜져 있으면 solo 트랙만 들린다. */
function trackAudible(timeline: Timeline, trackId: string): boolean {
  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track) return false;
  const anySolo = timeline.tracks.some((t) => t.solo);
  if (anySolo) return track.solo;
  return !track.muted;
}

/**
 * 타임라인 프레임을 각 트랙의 표시 대상으로 푼다.
 * 렌더 그래프와 재생 동기화가 같은 결과를 보도록 이 함수 하나만 쓴다.
 */
export function resolve(timeline: Timeline, frame: Frame): Presentation {
  const video = timeline.tracks.find((t) => t.kind === 'video');
  const audio = timeline.tracks.find((t) => t.kind === 'audio');
  const subtitle = timeline.tracks.find((t) => t.kind === 'subtitle');
  const overlay = timeline.tracks.find((t) => t.kind === 'overlay');

  const videoClip = video ? (clipAt(video, frame) ?? null) : null;
  const videoVisible = videoClip && videoClip.enabled && video && !video.muted ? videoClip : null;

  const audioClips = audio && trackAudible(timeline, audio.id)
    ? clipsInRange(audio, frame, frame + 1).filter((c) => c.enabled)
    : [];
  const subtitleClips = subtitle && !subtitle.muted
    ? clipsInRange(subtitle, frame, frame + 1).filter((c) => c.enabled)
    : [];
  const overlayClips = overlay && !overlay.muted
    ? clipsInRange(overlay, frame, frame + 1).filter((c) => c.enabled)
    : [];

  return {
    frame,
    videoClip: videoVisible,
    sourceFrame: videoVisible
      ? videoVisible.sourceInFrame + (frame - videoVisible.startFrame)
      : null,
    audioClips,
    subtitleClips,
    overlayClips,
    isGap: videoVisible === null,
  };
}

/** 클립 페이드를 반영한 게인(선형 0~1). */
export function clipFadeGain(clip: Clip, frame: Frame): number {
  const dur = clip.sourceOutFrame - clip.sourceInFrame;
  const local = frame - clip.startFrame;
  let g = 1;
  const fin = clip.fadeInFrames ?? 0;
  const fout = clip.fadeOutFrames ?? 0;
  if (fin > 0 && local < fin) g = Math.min(g, local / fin);
  if (fout > 0 && local > dur - fout) g = Math.min(g, Math.max(0, (dur - local) / fout));
  return Math.max(0, Math.min(1, g));
}

/** dB 게인을 선형 배율로. */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}
