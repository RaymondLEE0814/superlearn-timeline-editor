import { EngineError } from '../errors';
import type { Timeline } from '../types';
import { clipDuration, clipEnd, sortClips } from './model';

export interface ValidationIssue {
  code:
    | 'CLIP_OVERLAP'
    | 'NON_INTEGER'
    | 'EMPTY_CLIP'
    | 'SOURCE_RANGE'
    | 'MISSING_SOURCE'
    | 'LINK_MISMATCH'
    | 'WRONG_TRACK_KIND'
    | 'NEGATIVE_START';
  message: string;
  clipId?: string;
  trackId?: string;
}

/** 타임라인 불변식 검사. 결과가 비어 있으면 유효하다. */
export function validateTimeline(timeline: Timeline): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const clipById = new Map<string, { trackKind: string; start: number; end: number }>();

  for (const track of timeline.tracks) {
    const sorted = sortClips(track.clips);
    let prevEnd = -1;
    let prevId = '';

    for (const clip of sorted) {
      const dur = clipDuration(clip);
      const end = clipEnd(clip);
      clipById.set(clip.id, { trackKind: track.kind, start: clip.startFrame, end });

      if (
        !Number.isInteger(clip.startFrame) ||
        !Number.isInteger(clip.sourceInFrame) ||
        !Number.isInteger(clip.sourceOutFrame)
      ) {
        issues.push({
          code: 'NON_INTEGER',
          message: `클립 ${clip.id} 의 프레임 값이 정수가 아닙니다.`,
          clipId: clip.id,
          trackId: track.id,
        });
      }
      if (clip.startFrame < 0) {
        issues.push({
          code: 'NEGATIVE_START',
          message: `클립 ${clip.id} 의 시작이 음수입니다.`,
          clipId: clip.id,
          trackId: track.id,
        });
      }
      if (dur < 1) {
        issues.push({
          code: 'EMPTY_CLIP',
          message: `클립 ${clip.id} 의 길이가 1프레임 미만입니다.`,
          clipId: clip.id,
          trackId: track.id,
        });
      }
      const source = timeline.sources[clip.sourceId];
      if (!source) {
        issues.push({
          code: 'MISSING_SOURCE',
          message: `클립 ${clip.id} 이 참조하는 소스 ${clip.sourceId} 가 없습니다.`,
          clipId: clip.id,
          trackId: track.id,
        });
      } else if (clip.sourceInFrame < 0 || clip.sourceOutFrame > source.durationFrames) {
        issues.push({
          code: 'SOURCE_RANGE',
          message: `클립 ${clip.id} 의 소스 범위가 소스 길이를 벗어났습니다.`,
          clipId: clip.id,
          trackId: track.id,
        });
      }
      if (clip.startFrame < prevEnd) {
        issues.push({
          code: 'CLIP_OVERLAP',
          message: `클립 ${clip.id} 이 ${prevId} 과 겹칩니다.`,
          clipId: clip.id,
          trackId: track.id,
        });
      }
      if (track.kind === 'subtitle' && !clip.subtitle) {
        issues.push({
          code: 'WRONG_TRACK_KIND',
          message: `자막 트랙의 클립 ${clip.id} 에 자막 내용이 없습니다.`,
          clipId: clip.id,
          trackId: track.id,
        });
      }
      if (track.kind === 'overlay' && !clip.overlay) {
        issues.push({
          code: 'WRONG_TRACK_KIND',
          message: `오버레이 트랙의 클립 ${clip.id} 에 오버레이 정보가 없습니다.`,
          clipId: clip.id,
          trackId: track.id,
        });
      }

      prevEnd = end;
      prevId = clip.id;
    }
  }

  // 링크 클립(V1 <-> A1) 은 시작 · 길이가 같아야 한다.
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (!clip.linkedClipId) continue;
      const other = clipById.get(clip.linkedClipId);
      if (!other) {
        issues.push({
          code: 'LINK_MISMATCH',
          message: `클립 ${clip.id} 의 링크 대상 ${clip.linkedClipId} 이 없습니다.`,
          clipId: clip.id,
        });
        continue;
      }
      if (other.start !== clip.startFrame || other.end !== clipEnd(clip)) {
        issues.push({
          code: 'LINK_MISMATCH',
          message: `클립 ${clip.id} 과 링크 클립 ${clip.linkedClipId} 의 범위가 다릅니다.`,
          clipId: clip.id,
        });
      }
    }
  }

  return issues;
}

export function assertValidTimeline(timeline: Timeline): void {
  const issues = validateTimeline(timeline);
  if (issues.length > 0) {
    throw new EngineError('INVALID_TIMELINE', `타임라인 유효성 오류 ${issues.length}건`, {
      context: { issues: issues.slice(0, 10) },
    });
  }
}
