import { describe, expect, it } from 'vitest';
import { autoEdit, sourceRefFromMeta } from '../../src/engine/autoedit';
import { buildSpeechRanges, identifyBoundaries, segmentize } from '../../src/engine/autoedit/segments';
import { defaultRules, withRules } from '../../src/engine/autoedit/rules';
import { scoreSegments } from '../../src/engine/autoedit/score';
import { validateTimeline } from '../../src/engine/timeline/validate';
import { timelineDuration } from '../../src/engine/timeline/model';
import { generateLecture } from '../../src/mock/lectureGen';
import { CALC_30, LONG_90, SHORT_DEMO } from '../../src/mock/lectureSpecs';
import type { MediaMetadata } from '../../src/engine/types';

const calc = generateLecture(CALC_30);
const short = generateLecture(SHORT_DEMO);

function totalDuration(meta: MediaMetadata): number {
  return meta.stream.durationFrames;
}

describe('경계 식별', () => {
  it('4종 경계를 모두 만들고 정렬한다', () => {
    const b = identifyBoundaries(calc, defaultRules(calc.stream.fps));
    expect(b.length).toBeGreaterThan(100);
    const kinds = new Set(b.map((x) => x.kind));
    expect(kinds.has('chapter')).toBe(true);
    expect(kinds.has('sentence')).toBe(true);
    expect(kinds.has('scene')).toBe(true);
    for (let i = 1; i < b.length; i += 1) expect(b[i].frame).toBeGreaterThanOrEqual(b[i - 1].frame);
  });

  it('±3프레임 안의 후보를 병합한다', () => {
    const b = identifyBoundaries(calc, defaultRules(calc.stream.fps));
    for (let i = 1; i < b.length; i += 1) expect(b[i].frame - b[i - 1].frame).toBeGreaterThan(3);
  });
});

describe('발화 구간', () => {
  it('무음을 제거하고 패딩을 더한다', () => {
    const rules = defaultRules(calc.stream.fps);
    const ranges = buildSpeechRanges(calc, rules);
    expect(ranges.length).toBeGreaterThan(10);
    const total = ranges.reduce((s, r) => s + (r.endFrame - r.startFrame), 0);
    expect(total).toBeLessThan(totalDuration(calc));
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].startFrame).toBeGreaterThan(ranges[i - 1].endFrame);
    }
  });

  it('패딩을 늘리면 총 길이가 줄지 않는다 (단조성)', () => {
    const fps = calc.stream.fps;
    let prev = 0;
    for (const padSec of [0, 0.15, 0.3, 0.6]) {
      const rules = withRules(fps, { paddingFrames: Math.round(padSec * 30) });
      const total = buildSpeechRanges(calc, rules).reduce(
        (s, r) => s + (r.endFrame - r.startFrame),
        0,
      );
      expect(total).toBeGreaterThanOrEqual(prev);
      prev = total;
    }
  });
});

describe('세그먼트화', () => {
  it('최소 길이 미만 세그먼트가 남지 않는다', () => {
    const rules = defaultRules(calc.stream.fps);
    const segs = segmentize(buildSpeechRanges(calc, rules), identifyBoundaries(calc, rules), rules);
    const shortOnes = segs.filter(
      (s) => s.endFrame - s.startFrame < rules.minSegmentFrames && s.endFrame - s.startFrame > 0,
    );
    // 발화 구간 자체가 최소 길이보다 짧은 경우만 예외로 남는다.
    expect(shortOnes.length / segs.length).toBeLessThan(0.15);
  });

  it('최소 세그먼트 길이를 늘리면 세그먼트 수가 줄어든다 (단조성)', () => {
    const fps = calc.stream.fps;
    let prev = Number.POSITIVE_INFINITY;
    for (const sec of [1, 2, 5, 10]) {
      const rules = withRules(fps, { minSegmentFrames: sec * 30 });
      const segs = segmentize(buildSpeechRanges(calc, rules), identifyBoundaries(calc, rules), rules);
      expect(segs.length).toBeLessThanOrEqual(prev);
      prev = segs.length;
    }
  });

  it('최대 길이를 넘는 세그먼트가 없다', () => {
    const rules = withRules(calc.stream.fps, { maxSegmentFrames: 10 * 30 });
    const segs = segmentize(buildSpeechRanges(calc, rules), identifyBoundaries(calc, rules), rules);
    for (const s of segs) expect(s.endFrame - s.startFrame).toBeLessThanOrEqual(10 * 30);
  });

  it('키프레임 스냅이 실제 컷 지점을 키프레임에 맞춘다', () => {
    const rules = withRules(calc.stream.fps, { snapToKeyframe: true });
    const kf = calc.stream.keyframeIntervalFrames;
    const segs = segmentize(
      buildSpeechRanges(calc, rules),
      identifyBoundaries(calc, rules),
      rules,
      kf,
    );
    // 컷 지점 = 앞 세그먼트 끝과 떨어져 새로 시작하는 지점
    const cutPoints = segs.filter((s, i) => i === 0 || s.startFrame !== segs[i - 1].endFrame);
    expect(cutPoints.length).toBeGreaterThan(20);
    const snapped = cutPoints.filter((s) => s.startFrame % kf === 0);
    expect(snapped.length / cutPoints.length).toBeGreaterThan(0.9);
    // 스냅해도 세그먼트가 겹치지 않아야 한다.
    for (let i = 1; i < segs.length; i += 1) {
      expect(segs[i].startFrame).toBeGreaterThanOrEqual(segs[i - 1].endFrame);
    }
  });
});

describe('스코어링', () => {
  it('모든 점수가 0~1 이고 근거를 갖는다', () => {
    const rules = defaultRules(calc.stream.fps);
    const segs = segmentize(buildSpeechRanges(calc, rules), identifyBoundaries(calc, rules), rules);
    const scored = scoreSegments(segs, calc, rules);
    expect(scored).toHaveLength(segs.length);
    for (const s of scored) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
    expect(scored.some((s) => s.reasons.some((r) => r.startsWith('chapter-start')))).toBe(true);
    expect(scored.some((s) => s.reasons.some((r) => r.startsWith('keywords')))).toBe(true);
  });

  it('챕터 시작 세그먼트의 평균 점수가 더 높다', () => {
    const rules = defaultRules(calc.stream.fps);
    const segs = segmentize(buildSpeechRanges(calc, rules), identifyBoundaries(calc, rules), rules);
    const scored = scoreSegments(segs, calc, rules);
    const withChapter = scored.filter((s) => s.parts.chapterStart === 1);
    const without = scored.filter((s) => s.parts.chapterStart === 0);
    const avg = (a: typeof scored) => a.reduce((s, x) => s + x.score, 0) / Math.max(1, a.length);
    expect(avg(withChapter)).toBeGreaterThan(avg(without));
  });
});

describe('프리셋: silence-trim', () => {
  const result = autoEdit(calc, 'silence-trim');

  it('결과가 원본보다 짧고 유효하다', () => {
    expect(validateTimeline(result.timeline)).toEqual([]);
    expect(result.report.resultDurationFrames).toBeLessThan(result.report.sourceDurationFrames);
    expect(result.report.savedFrames).toBe(
      result.report.sourceDurationFrames - result.report.resultDurationFrames,
    );
  });

  it('타임라인 길이가 리포트 결과 길이와 같다', () => {
    expect(timelineDuration(result.timeline)).toBe(result.report.resultDurationFrames);
  });

  it('4개 트랙이 모두 채워진다', () => {
    for (const id of ['V1', 'O1', 'S1', 'A1']) {
      const t = result.timeline.tracks.find((x) => x.id === id)!;
      expect(t.clips.length, id).toBeGreaterThan(0);
    }
  });

  it('영상 클립이 갭 없이 이어진다', () => {
    const v = result.timeline.tracks.find((t) => t.id === 'V1')!;
    let cursor = 0;
    for (const c of v.clips) {
      expect(c.startFrame).toBe(cursor);
      cursor += c.sourceOutFrame - c.sourceInFrame;
    }
  });

  it('오디오 클립이 영상 클립과 링크된다', () => {
    const v = result.timeline.tracks.find((t) => t.id === 'V1')!;
    const a = result.timeline.tracks.find((t) => t.id === 'A1')!;
    expect(a.clips).toHaveLength(v.clips.length);
    for (let i = 0; i < v.clips.length; i += 1) {
      expect(v.clips[i].linkedClipId).toBe(a.clips[i].id);
      expect(a.clips[i].startFrame).toBe(v.clips[i].startFrame);
    }
  });
});

describe('프리셋: chapter-cut', () => {
  const result = autoEdit(calc, 'chapter-cut');

  it('말단 챕터 수 이하의 클립을 만든다', () => {
    const leaves = calc.chapters.filter((c) => !calc.chapters.some((o) => o.parentId === c.id));
    const v = result.timeline.tracks.find((t) => t.id === 'V1')!;
    expect(v.clips.length).toBeLessThanOrEqual(leaves.length);
    expect(v.clips.length).toBeGreaterThan(1);
    expect(validateTimeline(result.timeline)).toEqual([]);
  });

  it('챕터 마커가 생성된다', () => {
    expect(result.timeline.markers.length).toBeGreaterThan(1);
    expect(result.timeline.markers.every((m) => m.kind === 'chapter')).toBe(true);
  });
});

describe('프리셋: highlight', () => {
  it('목표 길이를 넘지 않는다', () => {
    const target = 5 * 60 * 30;
    const r = autoEdit(calc, 'highlight', { targetDurationFrames: target });
    expect(r.report.resultDurationFrames).toBeLessThanOrEqual(target);
    expect(r.report.resultDurationFrames).toBeGreaterThan(target * 0.7);
    expect(validateTimeline(r.timeline)).toEqual([]);
  });

  it('선택 구간이 시간순으로 정렬된다', () => {
    const r = autoEdit(calc, 'highlight', { targetDurationFrames: 3 * 60 * 30 });
    const segs = r.report.segments;
    for (let i = 1; i < segs.length; i += 1) {
      expect(segs[i].startFrame).toBeGreaterThanOrEqual(segs[i - 1].startFrame);
    }
  });

  it('목표가 너무 짧아도 최소 1개는 남는다', () => {
    const r = autoEdit(calc, 'highlight', { targetDurationFrames: 1 });
    expect(r.report.segments.length).toBe(1);
    expect(r.report.warnings.length).toBeGreaterThan(0);
  });

  it('목표 길이를 늘리면 결과 길이가 줄지 않는다 (단조성)', () => {
    let prev = 0;
    for (const min of [1, 3, 5, 10]) {
      const r = autoEdit(calc, 'highlight', { targetDurationFrames: min * 60 * 30 });
      expect(r.report.resultDurationFrames).toBeGreaterThanOrEqual(prev);
      prev = r.report.resultDurationFrames;
    }
  });
});

describe('프리셋: from-selection', () => {
  it('선택한 자막 구간이 모두 결과에 포함된다', () => {
    const picked = calc.transcript.segments.filter((_, i) => i % 40 === 0).slice(0, 12);
    const r = autoEdit(calc, 'from-selection', { selectedTranscriptIds: picked.map((p) => p.id) });
    expect(r.report.segments.length).toBeGreaterThan(0);
    expect(r.report.segments.length).toBeLessThanOrEqual(12);
    for (const p of picked) {
      const covered = r.report.segments.some(
        (s) => s.endFrame > p.startFrame && s.startFrame < p.endFrame,
      );
      expect(covered, `자막 ${p.id} 미포함`).toBe(true);
    }
    expect(validateTimeline(r.timeline)).toEqual([]);
  });

  it('선택이 없으면 경고와 빈 결과', () => {
    const r = autoEdit(calc, 'from-selection', { selectedTranscriptIds: [] });
    expect(r.report.segments).toHaveLength(0);
    expect(r.report.warnings.length).toBeGreaterThan(0);
  });
});

describe('결정성 · 성능 · 다른 fps', () => {
  it('같은 입력에 같은 결과를 낸다', () => {
    const a = autoEdit(calc, 'silence-trim');
    const b = autoEdit(calc, 'silence-trim');
    expect(JSON.stringify(a.timeline.tracks)).toBe(JSON.stringify(b.timeline.tracks));
  });

  it('25fps 짧은 강의도 처리한다', () => {
    const r = autoEdit(short, 'silence-trim');
    expect(validateTimeline(r.timeline)).toEqual([]);
    expect(r.timeline.fps).toEqual(short.stream.fps);
  });

  it('90분 60fps 강의를 500ms 안에 처리한다', () => {
    const long = generateLecture(LONG_90);
    const t0 = performance.now();
    const r = autoEdit(long, 'silence-trim');
    const ms = performance.now() - t0;
    expect(validateTimeline(r.timeline)).toEqual([]);
    expect(ms, `자동 편집 ${Math.round(ms)}ms`).toBeLessThan(500);
  });

  it('소스 참조가 메타데이터와 일치한다', () => {
    const src = sourceRefFromMeta(calc);
    expect(src.durationFrames).toBe(calc.stream.durationFrames);
    const r = autoEdit(calc, 'silence-trim');
    expect(r.timeline.sources[src.id]).toBeDefined();
  });
});
