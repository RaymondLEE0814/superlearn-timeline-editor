import type {
  Clip,
  Fps,
  Frame,
  Id,
  Marker,
  SourceRef,
  SubtitleStyle,
  Timeline,
  Track,
  TrackKind,
} from '../types';

export const TRACK_IDS = {
  video: 'V1',
  overlay: 'O1',
  subtitle: 'S1',
  audio: 'A1',
} as const;

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSizePx: 42,
  color: '#ffffff',
  background: 'rgba(0,0,0,0.62)',
  align: 'center',
  position: 'bottom',
};

export function clipDuration(clip: Clip): Frame {
  return clip.sourceOutFrame - clip.sourceInFrame;
}

export function clipEnd(clip: Clip): Frame {
  return clip.startFrame + clipDuration(clip);
}

export function trackDuration(track: Track): Frame {
  return track.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

export function timelineDuration(timeline: Timeline): Frame {
  return timeline.tracks.reduce((max, t) => Math.max(max, trackDuration(t)), 0);
}

export function findTrack(timeline: Timeline, trackId: Id): Track | undefined {
  return timeline.tracks.find((t) => t.id === trackId);
}

export function findClip(timeline: Timeline, clipId: Id): { track: Track; clip: Clip } | undefined {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

export function allClips(timeline: Timeline): Clip[] {
  return timeline.tracks.flatMap((t) => t.clips);
}

/** 트랙 표시 순서: V1 → O1 → S1 → A1 */
export const TRACK_ORDER: TrackKind[] = ['video', 'overlay', 'subtitle', 'audio'];

export function createTrack(kind: TrackKind, name: string): Track {
  return {
    id: TRACK_IDS[kind],
    kind,
    name,
    clips: [],
    muted: false,
    solo: false,
    locked: false,
  };
}

export interface CreateTimelineInput {
  id?: Id;
  name: string;
  mediaId: Id;
  fps: Fps;
  width: number;
  height: number;
  sources?: Record<Id, SourceRef>;
}

export function createEmptyTimeline(input: CreateTimelineInput): Timeline {
  const now = new Date(0).toISOString();
  return {
    id: input.id ?? `tl_${input.mediaId}`,
    name: input.name,
    mediaId: input.mediaId,
    fps: input.fps,
    width: input.width,
    height: input.height,
    sources: input.sources ?? {},
    tracks: [
      createTrack('video', '영상 V1'),
      createTrack('overlay', '오버레이 O1'),
      createTrack('subtitle', '자막 S1'),
      createTrack('audio', '오디오 A1'),
    ],
    markers: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export function makeMarker(frame: Frame, label: string, kind: Marker['kind'] = 'user'): Marker {
  const color = kind === 'chapter' ? '#FF3B30' : kind === 'auto' ? '#8E8E93' : '#0A84FF';
  return { id: `mk_${kind}_${frame}`, frame, label, color, kind };
}

/** 트랙 내 클립을 시작 프레임 오름차순으로 유지한다(불변식). */
export function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
}
