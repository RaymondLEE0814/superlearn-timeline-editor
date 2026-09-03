import type { Clip, Frame, Id, Timeline, Track } from '../types';
import { clipEnd, timelineDuration } from './model';

/** 해당 프레임에 걸린 클립(끝 프레임 exclusive). */
export function clipAt(track: Track, frame: Frame): Clip | undefined {
  return track.clips.find((c) => frame >= c.startFrame && frame < clipEnd(c));
}

export function clipsInRange(track: Track, startFrame: Frame, endFrame: Frame): Clip[] {
  return track.clips.filter((c) => clipEnd(c) > startFrame && c.startFrame < endFrame);
}

export type SnapKind = 'clip-start' | 'clip-end' | 'marker' | 'playhead' | 'keyframe' | 'zero';

export interface SnapCandidate {
  frame: Frame;
  kind: SnapKind;
  label?: string;
}

export function collectSnapFrames(
  timeline: Timeline,
  opts?: { playhead?: Frame; keyframeIntervalFrames?: number; excludeClipIds?: Set<Id> },
): SnapCandidate[] {
  const out: SnapCandidate[] = [{ frame: 0, kind: 'zero' }];
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (opts?.excludeClipIds?.has(clip.id)) continue;
      out.push({ frame: clip.startFrame, kind: 'clip-start', label: clip.label });
      out.push({ frame: clipEnd(clip), kind: 'clip-end', label: clip.label });
    }
  }
  for (const m of timeline.markers) out.push({ frame: m.frame, kind: 'marker', label: m.label });
  if (opts?.playhead != null) out.push({ frame: opts.playhead, kind: 'playhead' });
  if (opts?.keyframeIntervalFrames && opts.keyframeIntervalFrames > 1) {
    const dur = timelineDuration(timeline);
    for (let f = 0; f <= dur; f += opts.keyframeIntervalFrames) {
      out.push({ frame: f, kind: 'keyframe' });
    }
  }
  return out;
}

/** tolerance 프레임 이내에서 가장 가까운 스냅 후보. 없으면 null. */
export function snapCandidates(
  timeline: Timeline,
  frame: Frame,
  tolerance: number,
  opts?: Parameters<typeof collectSnapFrames>[1],
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const cand of collectSnapFrames(timeline, opts)) {
    const d = Math.abs(cand.frame - frame);
    if (d <= tolerance && d < bestDist) {
      best = cand;
      bestDist = d;
    }
  }
  return best;
}

/** 다음/이전 편집점(클립 경계 + 마커). 없으면 현재 프레임 유지. */
export function nextEdgeFrame(timeline: Timeline, frame: Frame, dir: 1 | -1): Frame {
  const edges = new Set<Frame>([0]);
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      edges.add(clip.startFrame);
      edges.add(clipEnd(clip));
    }
  }
  for (const m of timeline.markers) edges.add(m.frame);

  const sorted = [...edges].sort((a, b) => a - b);
  if (dir === 1) {
    for (const e of sorted) if (e > frame) return e;
    return frame;
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) if (sorted[i] < frame) return sorted[i];
  return frame;
}

/** 타임라인 프레임 -> 원본 미디어 프레임. 영상 트랙 기준. 갭이면 null. */
export function timelineFrameToSourceFrame(
  timeline: Timeline,
  frame: Frame,
): { clip: Clip; sourceFrame: Frame } | null {
  const video = timeline.tracks.find((t) => t.kind === 'video');
  if (!video) return null;
  const clip = clipAt(video, frame);
  if (!clip) return null;
  return { clip, sourceFrame: clip.sourceInFrame + (frame - clip.startFrame) };
}

/** 원본 미디어 프레임 -> 타임라인 프레임. 여러 클립이 같은 소스를 쓰면 첫 매칭. */
export function sourceFrameToTimelineFrame(timeline: Timeline, sourceFrame: Frame): Frame | null {
  const video = timeline.tracks.find((t) => t.kind === 'video');
  if (!video) return null;
  for (const clip of video.clips) {
    if (sourceFrame >= clip.sourceInFrame && sourceFrame < clip.sourceOutFrame) {
      return clip.startFrame + (sourceFrame - clip.sourceInFrame);
    }
  }
  return null;
}
