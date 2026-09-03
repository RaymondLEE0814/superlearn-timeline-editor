import type {
  AutoEditPreset,
  AutoEditReport,
  AutoEditRules,
  Clip,
  Frame,
  FrameRange,
  Id,
  MediaMetadata,
  RemovalReason,
  ScoredSegment,
  SourceRef,
  Timeline,
} from '../types';
import { DEFAULT_SUBTITLE_STYLE, createEmptyTimeline, makeMarker } from '../timeline/model';
import type { SelectionResult } from './select';

const OVERLAY_RECT = { x: 0.615, y: 0.055, w: 0.335, h: 0.255 };

function slideIntervals(meta: MediaMetadata): Array<FrameRange & { slideId: Id; imageRef: string; title: string }> {
  const sorted = [...meta.slides].sort((a, b) => a.frame - b.frame);
  return sorted.map((s, i) => ({
    startFrame: s.frame,
    endFrame: i + 1 < sorted.length ? sorted[i + 1].frame : meta.stream.durationFrames,
    slideId: s.slideId,
    imageRef: s.imageRef,
    title: s.title,
  }));
}

export interface PlaceInput {
  /** 배치할(선택된) 세그먼트 */
  segments: ScoredSegment[];
  /** 점수가 매겨진 전체 후보. 리포트의 제거 사유 판정에 쓴다. */
  allScored: ScoredSegment[];
  meta: MediaMetadata;
  rules: AutoEditRules;
  preset: AutoEditPreset;
  selection: SelectionResult;
  source: SourceRef;
}

/**
 * 선택된 세그먼트를 다중 트랙(V1/A1/S1/O1)에 순차 배치한다.
 * 갭 없이 이어 붙이므로 결과 길이 = 세그먼트 길이 합이다.
 */
export function placeOnTimeline(input: PlaceInput): { timeline: Timeline; report: AutoEditReport } {
  const { segments, meta, rules, preset, selection, source } = input;

  const timeline = createEmptyTimeline({
    id: `tl_${meta.mediaId}`,
    name: meta.title,
    mediaId: meta.mediaId,
    fps: meta.stream.fps,
    width: meta.stream.width,
    height: meta.stream.height,
    sources: { [source.id]: source },
  });

  const videoClips: Clip[] = [];
  const audioClips: Clip[] = [];
  const subtitleClips: Clip[] = [];
  const overlayClips: Clip[] = [];
  const slides = slideIntervals(meta);

  let cursor: Frame = 0;
  segments.forEach((seg, i) => {
    const dur = seg.endFrame - seg.startFrame;
    if (dur < 1) return;
    const n = String(i + 1).padStart(3, '0');
    const label = seg.reasons.find((r) => r.startsWith('chapter'))?.split(':')[1] ?? `구간 ${n}`;

    const vId = `v${n}`;
    const aId = `a${n}`;
    videoClips.push({
      id: vId,
      trackId: 'V1',
      sourceId: source.id,
      sourceInFrame: seg.startFrame,
      sourceOutFrame: seg.endFrame,
      startFrame: cursor,
      enabled: true,
      label,
      linkedClipId: aId,
      meta: { segmentId: seg.id, chapterId: seg.chapterId, score: seg.score, reasons: seg.reasons },
    });
    audioClips.push({
      id: aId,
      trackId: 'A1',
      sourceId: source.id,
      sourceInFrame: seg.startFrame,
      sourceOutFrame: seg.endFrame,
      startFrame: cursor,
      enabled: true,
      label,
      linkedClipId: vId,
      gain: 0,
      fadeInFrames: 0,
      fadeOutFrames: 0,
    });

    // 자막: 세그먼트와 겹치는 부분만 잘라 배치
    let sIdx = 0;
    for (const t of meta.transcript.segments) {
      const s = Math.max(t.startFrame, seg.startFrame);
      const e = Math.min(t.endFrame, seg.endFrame);
      if (e - s < 1) continue;
      subtitleClips.push({
        id: `s${n}_${String(sIdx++).padStart(2, '0')}`,
        trackId: 'S1',
        sourceId: source.id,
        sourceInFrame: s,
        sourceOutFrame: e,
        startFrame: cursor + (s - seg.startFrame),
        enabled: true,
        label: t.text.slice(0, 18),
        subtitle: { text: t.text, style: DEFAULT_SUBTITLE_STYLE },
        meta: { segmentId: t.id, chapterId: t.chapterId },
      });
    }

    // 오버레이: 해당 구간에 활성인 슬라이드
    let oIdx = 0;
    for (const sl of slides) {
      const s = Math.max(sl.startFrame, seg.startFrame);
      const e = Math.min(sl.endFrame, seg.endFrame);
      if (e - s < 1) continue;
      overlayClips.push({
        id: `o${n}_${String(oIdx++).padStart(2, '0')}`,
        trackId: 'O1',
        sourceId: source.id,
        sourceInFrame: s,
        sourceOutFrame: e,
        startFrame: cursor + (s - seg.startFrame),
        enabled: true,
        label: sl.title,
        overlay: { kind: 'slide', imageRef: sl.imageRef, rect: OVERLAY_RECT, opacity: 1 },
      });
    }

    cursor += dur;
  });

  // 챕터 마커: 원본 프레임을 타임라인 프레임으로 옮긴다.
  const markers = [];
  const leaves = meta.chapters.filter((c) => !meta.chapters.some((o) => o.parentId === c.id));
  for (const ch of leaves) {
    const clip = videoClips.find(
      (c) => ch.startFrame >= c.sourceInFrame && ch.startFrame < c.sourceOutFrame,
    );
    if (!clip) continue;
    markers.push(makeMarker(clip.startFrame + (ch.startFrame - clip.sourceInFrame), ch.title, 'chapter'));
  }

  const placed: Timeline = {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (t.id === 'V1') return { ...t, clips: videoClips };
      if (t.id === 'A1') return { ...t, clips: audioClips };
      if (t.id === 'S1') return { ...t, clips: subtitleClips };
      if (t.id === 'O1') return { ...t, clips: overlayClips };
      return t;
    }),
    markers,
  };

  const report = buildReport({
    segments,
    allScored: input.allScored,
    meta,
    preset,
    selection,
    resultDuration: cursor,
  });
  void rules;
  return { timeline: placed, report };
}

function buildReport(input: {
  segments: ScoredSegment[];
  allScored: ScoredSegment[];
  meta: MediaMetadata;
  preset: AutoEditPreset;
  selection: SelectionResult;
  resultDuration: Frame;
}): AutoEditReport {
  const { segments, allScored, meta, preset, selection, resultDuration } = input;
  const duration = meta.stream.durationFrames;

  // 제외된 세그먼트를 사유와 함께 모아 둔다.
  const excludedSegments: Array<{ seg: ScoredSegment; reason: RemovalReason }> = [];
  const byId = new Map<Id, ScoredSegment>(allScored.map((s) => [s.id, s] as const));
  for (const [id, reason] of selection.excluded) {
    const seg = byId.get(id);
    if (seg) excludedSegments.push({ seg, reason });
  }

  // 무음이 아니라 명시적으로 빠진 구간이면 그 사유를 쓴다.
  function reasonFor(range: FrameRange): RemovalReason {
    let best: RemovalReason = 'silence';
    let bestOverlap = 0;
    for (const { seg, reason } of excludedSegments) {
      const overlap =
        Math.min(seg.endFrame, range.endFrame) - Math.max(seg.startFrame, range.startFrame);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = reason;
      }
    }
    return best;
  }

  // 선택된 구간의 여집합이 제거 구간이다.
  const kept = [...segments].sort((a, b) => a.startFrame - b.startFrame);
  const removed: Array<FrameRange & { reason: RemovalReason }> = [];
  let cursor = 0;
  for (const s of kept) {
    if (s.startFrame > cursor) {
      const range = { startFrame: cursor, endFrame: s.startFrame };
      removed.push({ ...range, reason: reasonFor(range) });
    }
    cursor = Math.max(cursor, s.endFrame);
  }
  if (cursor < duration) {
    const range = { startFrame: cursor, endFrame: duration };
    removed.push({ ...range, reason: reasonFor(range) });
  }

  return {
    preset,
    sourceDurationFrames: duration,
    resultDurationFrames: resultDuration,
    savedFrames: duration - resultDuration,
    removed,
    segments,
    candidates: allScored,
    warnings: selection.warnings,
  };
}
