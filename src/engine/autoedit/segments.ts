import { floorToKeyframe } from '../timebase';
import type {
  AutoEditRules,
  Boundary,
  BoundaryKind,
  Frame,
  FrameRange,
  MediaMetadata,
  Segment,
} from '../types';

const MERGE_TOLERANCE = 3;

/** 편집 경계 후보를 모아 ±3프레임 이내는 가중치가 큰 것으로 병합한다. */
export function identifyBoundaries(meta: MediaMetadata, rules: AutoEditRules): Boundary[] {
  const raw: Boundary[] = [];

  for (const sc of meta.sceneChanges) {
    if (sc.score >= 0.5) {
      raw.push({ frame: sc.frame, kind: 'scene', weight: rules.boundaryWeights.scene * sc.score });
    }
  }
  for (const seg of meta.transcript.segments) {
    if (seg.isSentenceEnd) {
      raw.push({ frame: seg.endFrame, kind: 'sentence', weight: rules.boundaryWeights.sentence });
    }
  }
  for (const ch of meta.chapters) {
    raw.push({ frame: ch.startFrame, kind: 'chapter', weight: rules.boundaryWeights.chapter });
  }
  for (const s of meta.silences) {
    raw.push({
      frame: Math.round((s.startFrame + s.endFrame) / 2),
      kind: 'silence',
      weight: rules.boundaryWeights.silence,
    });
  }

  raw.sort((a, b) => a.frame - b.frame || b.weight - a.weight);

  const out: Boundary[] = [];
  for (const b of raw) {
    const last = out[out.length - 1];
    if (last && b.frame - last.frame <= MERGE_TOLERANCE) {
      if (b.weight > last.weight) out[out.length - 1] = { ...b, frame: last.frame };
      continue;
    }
    out.push(b);
  }
  return out;
}

function mergeRanges(ranges: FrameRange[]): FrameRange[] {
  const sorted = [...ranges].sort((a, b) => a.startFrame - b.startFrame);
  const out: FrameRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startFrame <= last.endFrame) {
      last.endFrame = Math.max(last.endFrame, r.endFrame);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** 유효 무음의 여집합에 패딩을 더한 발화 구간. */
export function buildSpeechRanges(meta: MediaMetadata, rules: AutoEditRules): FrameRange[] {
  const duration = meta.stream.durationFrames;
  const valid = meta.silences
    .filter(
      (s) =>
        s.endFrame - s.startFrame >= rules.minSilenceFrames &&
        s.levelDb <= rules.silenceThresholdDb,
    )
    .sort((a, b) => a.startFrame - b.startFrame);

  const speech: FrameRange[] = [];
  let cursor = 0;
  for (const s of valid) {
    const start = Math.max(0, s.startFrame);
    if (start > cursor) speech.push({ startFrame: cursor, endFrame: start });
    cursor = Math.max(cursor, s.endFrame);
  }
  if (cursor < duration) speech.push({ startFrame: cursor, endFrame: duration });

  const padded = speech.map((r) => ({
    startFrame: Math.max(0, r.startFrame - rules.paddingFrames),
    endFrame: Math.min(duration, r.endFrame + rules.paddingFrames),
  }));

  return mergeRanges(padded).filter((r) => r.endFrame > r.startFrame);
}

/** 발화 구간을 경계에서 나눈 뒤 최소/최대 길이 규칙으로 정리한다. */
export function segmentize(
  ranges: FrameRange[],
  boundaries: Boundary[],
  rules: AutoEditRules,
  keyframeIntervalFrames = 0,
): Segment[] {
  const out: Segment[] = [];
  let idx = 0;

  for (const range of ranges) {
    const inside = boundaries.filter(
      (b) => b.frame > range.startFrame && b.frame < range.endFrame,
    );

    // 1) 경계에서 분할
    let pieces: Array<FrameRange & { kinds: BoundaryKind[] }> = [];
    let cursor = range.startFrame;
    let kinds: BoundaryKind[] = [];
    for (const b of inside) {
      pieces.push({ startFrame: cursor, endFrame: b.frame, kinds: [...kinds] });
      cursor = b.frame;
      kinds = [b.kind];
    }
    pieces.push({ startFrame: cursor, endFrame: range.endFrame, kinds: [...kinds] });

    // 2) 최소 길이 미만은 이웃과 병합 (구간 밖으로는 병합하지 않는다)
    const merged: typeof pieces = [];
    for (const p of pieces) {
      const prev = merged[merged.length - 1];
      if (prev && p.endFrame - p.startFrame < rules.minSegmentFrames) {
        prev.endFrame = p.endFrame;
        prev.kinds = [...new Set([...prev.kinds, ...p.kinds])];
        continue;
      }
      merged.push({ ...p });
    }
    // 앞쪽이 짧게 남은 경우 뒤와 병합
    while (
      merged.length > 1 &&
      merged[0].endFrame - merged[0].startFrame < rules.minSegmentFrames
    ) {
      const first = merged.shift()!;
      merged[0].startFrame = first.startFrame;
      merged[0].kinds = [...new Set([...first.kinds, ...merged[0].kinds])];
    }

    // 3) 최대 길이 초과는 가장 가까운 문장 경계에서 분할
    pieces = [];
    for (const p of merged) {
      let start = p.startFrame;
      let guard = 0;
      while (p.endFrame - start > rules.maxSegmentFrames && guard < 1000) {
        guard += 1;
        const limit = start + rules.maxSegmentFrames;
        const sentence = [...boundaries]
          .filter((b) => b.kind === 'sentence' && b.frame > start && b.frame <= limit)
          .pop();
        const cut = sentence ? sentence.frame : limit;
        pieces.push({ startFrame: start, endFrame: cut, kinds: p.kinds });
        start = cut;
      }
      pieces.push({ startFrame: start, endFrame: p.endFrame, kinds: p.kinds });
    }

    for (const p of pieces) {
      if (p.endFrame - p.startFrame < 1) continue;
      out.push({
        id: `sg${String(idx++).padStart(4, '0')}`,
        startFrame: p.startFrame,
        endFrame: p.endFrame,
        boundaryKinds: p.kinds,
      });
    }
  }

  return rules.snapToKeyframe && keyframeIntervalFrames > 1
    ? snapSegmentsToKeyframes(out, keyframeIntervalFrames)
    : out;
}

/**
 * 스트리밍 친화 컷: 실제 컷이 일어나는 지점(앞 세그먼트와 떨어진 시작)만 키프레임으로 내린다.
 * 같은 발화 구간 안에서 이어지는 경계는 재생이 끊기지 않으므로 스냅해도 이득이 없고,
 * 앞 세그먼트를 침범하게 되어 오히려 겹침을 만든다.
 */
function snapSegmentsToKeyframes(segments: Segment[], interval: number): Segment[] {
  const out: Segment[] = [];
  let prevEnd = -1;
  for (const s of segments) {
    const isCutPoint = prevEnd < 0 || s.startFrame !== prevEnd;
    let start: Frame = s.startFrame;
    if (isCutPoint) {
      const floor = Math.max(prevEnd < 0 ? 0 : prevEnd, floorToKeyframe(s.startFrame, interval));
      start = Math.min(floor, s.endFrame - 1);
    }
    out.push({ ...s, startFrame: start });
    prevEnd = s.endFrame;
  }
  return out;
}
