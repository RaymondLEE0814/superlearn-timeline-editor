import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/engine/errors';
import { applyCommand, type Command } from '../../src/engine/timeline/commands';
import { canRedo, canUndo, commit, emptyHistory, redo, undo } from '../../src/engine/timeline/history';
import { clipDuration, clipEnd, findClip, timelineDuration } from '../../src/engine/timeline/model';
import { clipAt, nextEdgeFrame, snapCandidates } from '../../src/engine/timeline/query';
import { validateTimeline } from '../../src/engine/timeline/validate';
import {
  SOURCE_DURATION,
  baseTimeline,
  makeRng,
  normalize,
  populated,
  run,
  videoClip,
} from './helpers';

describe('timeline 모델', () => {
  it('빈 타임라인은 4트랙을 갖고 유효하다', () => {
    const tl = baseTimeline();
    expect(tl.tracks.map((t) => t.id)).toEqual(['V1', 'O1', 'S1', 'A1']);
    expect(validateTimeline(tl)).toEqual([]);
    expect(timelineDuration(tl)).toBe(0);
  });

  it('populated 타임라인이 유효하다', () => {
    const tl = populated();
    expect(validateTimeline(tl)).toEqual([]);
    expect(timelineDuration(tl)).toBe(1100);
  });

  it('클립 길이 · 끝 계산이 exclusive 규칙을 따른다', () => {
    const c = videoClip('x', 100, 10, 40);
    expect(clipDuration(c)).toBe(30);
    expect(clipEnd(c)).toBe(130);
  });
});

describe('명령: addClip', () => {
  it('겹치면 CLIP_OVERLAP', () => {
    const tl = populated();
    expect(() =>
      applyCommand(tl, { type: 'addClip', clip: videoClip('vx', 100, 0, 100) }),
    ).toThrowError(EngineError);
  });

  it('잠긴 트랙이면 TRACK_LOCKED', () => {
    const tl = run(populated(), [{ type: 'setTrackFlag', trackId: 'V1', flag: 'locked', value: true }]);
    try {
      applyCommand(tl, { type: 'addClip', clip: videoClip('vx', 5000, 0, 100) });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe('TRACK_LOCKED');
    }
  });

  it('정수가 아니면 INVALID_ARGUMENT', () => {
    const tl = baseTimeline();
    try {
      applyCommand(tl, { type: 'addClip', clip: videoClip('vx', 1.5, 0, 100) });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe('INVALID_ARGUMENT');
    }
  });
});

describe('명령: trim', () => {
  it('trimStart 는 소스와 타임라인 시작을 함께 옮긴다', () => {
    const tl = populated();
    const { next } = applyCommand(tl, { type: 'trimStart', clipId: 'v1', delta: 50 });
    const c = findClip(next, 'v1')!.clip;
    expect(c.startFrame).toBe(50);
    expect(c.sourceInFrame).toBe(150);
    expect(clipDuration(c)).toBe(250);
  });

  it('trimStart 는 링크된 오디오 클립도 함께 조정한다', () => {
    const tl = populated();
    const { next } = applyCommand(tl, { type: 'trimStart', clipId: 'v1', delta: 50 });
    const a = findClip(next, 'a1')!.clip;
    expect(a.startFrame).toBe(50);
    expect(a.sourceInFrame).toBe(150);
    expect(validateTimeline(next)).toEqual([]);
  });

  it('최소 1프레임 아래로 줄지 않는다', () => {
    const tl = populated();
    const { next, applied } = applyCommand(tl, { type: 'trimStart', clipId: 'v1', delta: 99999 });
    expect(clipDuration(findClip(next, 'v1')!.clip)).toBe(1);
    expect((applied as { delta: number }).delta).toBe(299);
  });

  it('trimEnd 는 소스 길이를 넘지 않는다', () => {
    const tl = run(baseTimeline(), [
      { type: 'addClip', clip: videoClip('v1', 0, SOURCE_DURATION - 10, SOURCE_DURATION) },
    ]);
    const { next, applied } = applyCommand(tl, { type: 'trimEnd', clipId: 'v1', delta: 500 });
    expect(findClip(next, 'v1')!.clip.sourceOutFrame).toBe(SOURCE_DURATION);
    expect((applied as { delta: number }).delta).toBe(0);
  });
});

describe('명령: split', () => {
  it('클립을 두 개로 나누고 링크 클립도 나눈다', () => {
    const tl = populated();
    const { next } = applyCommand(tl, { type: 'splitClip', clipId: 'v1', atFrame: 150 });
    const v = next.tracks.find((t) => t.id === 'V1')!;
    const a = next.tracks.find((t) => t.id === 'A1')!;
    expect(v.clips.map((c) => c.id)).toEqual(['v1_a', 'v1_b', 'v2', 'v3']);
    expect(a.clips.map((c) => c.id)).toEqual(['a1_a', 'a1_b']);
    expect(findClip(next, 'v1_a')!.clip.sourceOutFrame).toBe(250);
    expect(findClip(next, 'v1_b')!.clip.sourceInFrame).toBe(250);
    expect(findClip(next, 'v1_a')!.clip.linkedClipId).toBe('a1_a');
    expect(validateTimeline(next)).toEqual([]);
  });

  it('클립 밖 지점이면 OUT_OF_RANGE', () => {
    const tl = populated();
    try {
      applyCommand(tl, { type: 'splitClip', clipId: 'v1', atFrame: 0 });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe('OUT_OF_RANGE');
    }
  });
});

describe('명령: 리플 삭제', () => {
  it('뒤 클립을 당기고 유효성을 유지한다', () => {
    const tl = populated();
    const { next } = applyCommand(tl, { type: 'removeClip', clipId: 'v2', ripple: true });
    expect(findClip(next, 'v2')).toBeUndefined();
    expect(findClip(next, 'v3')!.clip.startFrame).toBe(300);
    expect(validateTimeline(next)).toEqual([]);
  });

  it('리플 삭제를 되돌리면 원상 복구된다', () => {
    const tl = populated();
    const { next, inverse } = applyCommand(tl, { type: 'removeClip', clipId: 'v2', ripple: true });
    const back = applyCommand(next, inverse).next;
    expect(normalize(back)).toEqual(normalize(tl));
  });

  it('링크된 클립도 함께 삭제된다', () => {
    const tl = populated();
    const { next } = applyCommand(tl, { type: 'removeClip', clipId: 'v1' });
    expect(findClip(next, 'a1')).toBeUndefined();
  });
});

describe('query', () => {
  it('clipAt 은 끝 프레임을 제외한다', () => {
    const tl = populated();
    const v = tl.tracks.find((t) => t.id === 'V1')!;
    expect(clipAt(v, 299)!.id).toBe('v1');
    expect(clipAt(v, 300)!.id).toBe('v2');
  });

  it('nextEdgeFrame 이 다음/이전 편집점을 찾는다', () => {
    const tl = populated();
    expect(nextEdgeFrame(tl, 0, 1)).toBe(150);
    expect(nextEdgeFrame(tl, 310, -1)).toBe(300);
    expect(nextEdgeFrame(tl, 99999, 1)).toBe(99999);
  });

  it('snapCandidates 가 허용 범위 안의 가장 가까운 후보를 준다', () => {
    const tl = populated();
    expect(snapCandidates(tl, 302, 5)!.frame).toBe(300);
    expect(snapCandidates(tl, 500, 5)).toBeNull();
  });
});

describe('history', () => {
  it('undo/redo 가 타임라인을 복원한다', () => {
    const tl = populated();
    const h0 = emptyHistory();
    const r1 = commit(tl, h0, { type: 'removeClip', clipId: 'v2', ripple: true });
    expect(canUndo(r1.history)).toBe(true);
    const r2 = undo(r1.timeline, r1.history);
    expect(normalize(r2.timeline)).toEqual(normalize(tl));
    expect(canRedo(r2.history)).toBe(true);
    const r3 = redo(r2.timeline, r2.history);
    expect(normalize(r3.timeline)).toEqual(normalize(r1.timeline));
  });

  it('coalesceKey 가 같으면 한 단계로 합쳐진다', () => {
    const tl = populated();
    let state = { timeline: tl, history: emptyHistory() };
    for (let i = 0; i < 10; i += 1) {
      state = commit(state.timeline, state.history, { type: 'trimEnd', clipId: 'v3', delta: 1 }, 'drag:v3');
    }
    expect(state.history.past).toHaveLength(1);
    const back = undo(state.timeline, state.history);
    expect(normalize(back.timeline)).toEqual(normalize(tl));
  });

  it('히스토리가 비면 undo/redo 는 무동작이다', () => {
    const tl = populated();
    const h = emptyHistory();
    expect(undo(tl, h).timeline).toBe(tl);
    expect(redo(tl, h).timeline).toBe(tl);
  });
});

describe('속성 테스트: 랜덤 명령 시퀀스의 undo 는 항상 원상 복구', () => {
  const CANDIDATE_CLIPS = ['v1', 'v2', 'v3'];

  function randomCommand(rng: () => number, tl: ReturnType<typeof populated>): Command | null {
    const clipIds = tl.tracks
      .find((t) => t.id === 'V1')!
      .clips.map((c) => c.id)
      .filter((id) => CANDIDATE_CLIPS.some((c) => id.startsWith(c)));
    if (clipIds.length === 0) return null;
    const clipId = clipIds[Math.floor(rng() * clipIds.length)];
    const found = findClip(tl, clipId);
    if (!found) return null;
    const dur = clipDuration(found.clip);
    const pick = Math.floor(rng() * 6);
    switch (pick) {
      case 0:
        return { type: 'trimEnd', clipId, delta: Math.floor(rng() * 40) - 20 };
      case 1:
        return { type: 'trimStart', clipId, delta: Math.floor(rng() * 40) - 20 };
      case 2:
        return { type: 'removeClip', clipId, ripple: rng() > 0.5 };
      case 3:
        return dur > 2 ? { type: 'splitClip', clipId, atFrame: found.clip.startFrame + 1 + Math.floor(rng() * (dur - 2)) } : null;
      case 4:
        return { type: 'setClipProps', clipId, props: { label: `L${Math.floor(rng() * 100)}`, enabled: rng() > 0.5 } };
      default:
        return { type: 'addMarker', marker: { id: `mk${Math.floor(rng() * 50)}`, frame: Math.floor(rng() * 1000), label: 'm', color: '#000', kind: 'user' } };
    }
  }

  it('100회 시드 × 최대 12명령', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const rng = makeRng(seed);
      const start = populated();
      let timeline = start;
      let history = emptyHistory();
      let applied = 0;
      for (let i = 0; i < 12; i += 1) {
        const cmd = randomCommand(rng, timeline);
        if (!cmd) continue;
        try {
          const r = commit(timeline, history, cmd);
          timeline = r.timeline;
          history = r.history;
          applied += 1;
        } catch {
          // 겹침 · 범위 오류는 정상적인 거부이므로 무시한다.
        }
        expect(validateTimeline(timeline)).toEqual([]);
      }
      while (history.past.length > 0) {
        const r = undo(timeline, history);
        timeline = r.timeline;
        history = r.history;
      }
      expect(normalize(timeline), `seed=${seed} applied=${applied}`).toEqual(normalize(start));
    }
  });
});

describe('validateTimeline', () => {
  it('겹침을 검출한다', () => {
    const tl = populated();
    const broken = {
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id === 'V1' ? { ...t, clips: t.clips.map((c) => (c.id === 'v2' ? { ...c, startFrame: 100 } : c)) } : t,
      ),
    };
    expect(validateTimeline(broken).some((i) => i.code === 'CLIP_OVERLAP')).toBe(true);
  });

  it('소스 범위 초과를 검출한다', () => {
    const tl = populated();
    const broken = {
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id === 'V1' ? { ...t, clips: t.clips.map((c) => (c.id === 'v3' ? { ...c, sourceOutFrame: 99999 } : c)) } : t,
      ),
    };
    expect(validateTimeline(broken).some((i) => i.code === 'SOURCE_RANGE')).toBe(true);
  });

  it('링크 불일치를 검출한다', () => {
    const tl = populated();
    const broken = {
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id === 'A1' ? { ...t, clips: t.clips.map((c) => ({ ...c, startFrame: c.startFrame + 5 })) } : t,
      ),
    };
    expect(validateTimeline(broken).some((i) => i.code === 'LINK_MISMATCH')).toBe(true);
  });
});
