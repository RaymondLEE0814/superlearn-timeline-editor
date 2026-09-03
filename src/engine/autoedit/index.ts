import type {
  AutoEditPreset,
  AutoEditResult,
  AutoEditRules,
  MediaMetadata,
  SourceRef,
} from '../types';
import { withRules } from './rules';
import { buildSpeechRanges, identifyBoundaries, segmentize } from './segments';
import { scoreSegments } from './score';
import { selectSegments } from './select';
import { placeOnTimeline } from './place';

export * from './rules';
export * from './segments';
export * from './score';
export * from './select';
export * from './place';

export function sourceRefFromMeta(meta: MediaMetadata): SourceRef {
  return {
    id: `src_${meta.mediaId}`,
    mediaId: meta.mediaId,
    kind: meta.stream.sourceKind,
    durationFrames: meta.stream.durationFrames,
    fps: meta.stream.fps,
    label: meta.title,
  };
}

/**
 * 자동 편집 전체 파이프라인.
 * 경계 식별 → 발화 구간 → 세그먼트 → 스코어 → 프리셋 선택 → 트랙 배치.
 * 순수 함수이므로 같은 입력에 항상 같은 결과를 낸다.
 */
export function autoEdit(
  meta: MediaMetadata,
  preset: AutoEditPreset,
  partialRules?: Partial<AutoEditRules>,
  source?: SourceRef,
): AutoEditResult {
  const rules = withRules(meta.stream.fps, partialRules);
  const boundaries = identifyBoundaries(meta, rules);
  const speech = buildSpeechRanges(meta, rules);
  const segments = segmentize(speech, boundaries, rules, meta.stream.keyframeIntervalFrames);
  const scored = scoreSegments(segments, meta, rules);
  const selection = selectSegments(scored, preset, rules, meta);
  const { timeline, report } = placeOnTimeline({
    segments: selection.selected,
    allScored: scored,
    meta,
    rules,
    preset,
    selection,
    source: source ?? sourceRefFromMeta(meta),
  });
  return { timeline, report, rulesUsed: rules, preset };
}
