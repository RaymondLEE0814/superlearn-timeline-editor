import { describe, expect, it, vi } from 'vitest';
import { FakeClockDeps, MasterClock } from '../../src/engine/playback/clock';
import { MockStreamController } from '../../src/engine/playback/stream';
import { SyntheticVideoSource } from '../../src/engine/playback/sources';
import { clipFadeGain, dbToLinear, resolve } from '../../src/engine/playback/sync';
import { RecordingCtx } from '../../src/engine/render/ctx';
import { FPS_30 } from '../../src/engine/timebase';
import { applyCommand } from '../../src/engine/timeline/commands';
import { populated } from './helpers';

function makeClock(duration = 300) {
  const deps = new FakeClockDeps();
  const clock = new MasterClock(FPS_30, duration, deps);
  return { clock, deps };
}

describe('MasterClock', () => {
  it('1초 재생하면 정확히 fps 개 프레임 이벤트가 난다', () => {
    const { clock, deps } = makeClock();
    const seen: number[] = [];
    clock.events.on('frame', ({ frame }) => seen.push(frame));
    clock.play();
    // 10ms 는 부동소수로 정확히 표현되므로 누적 오차 없이 정확히 1000ms 가 된다.
    for (let i = 0; i < 100; i += 1) deps.advance(10);
    expect(seen).toHaveLength(30);
    expect(seen[0]).toBe(1);
    expect(seen[29]).toBe(30);
  });

  it('같은 프레임을 두 번 발행하지 않는다', () => {
    const { clock, deps } = makeClock();
    const seen: number[] = [];
    clock.events.on('frame', ({ frame }) => seen.push(frame));
    clock.play();
    // 프레임 간격보다 훨씬 촘촘히 틱해도 중복이 없어야 한다.
    for (let i = 0; i < 200; i += 1) deps.advance(2);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('배속이 진행 속도에 반영된다', () => {
    const { clock, deps } = makeClock();
    clock.setRate(2);
    clock.play();
    deps.advance(1000);
    expect(clock.currentFrame).toBe(60);
  });

  it('0.5배속은 절반만 진행한다', () => {
    const { clock, deps } = makeClock();
    clock.setRate(0.5);
    clock.play();
    deps.advance(1000);
    expect(clock.currentFrame).toBe(15);
  });

  it('끝에 닿으면 정지하고 ended 를 낸다', () => {
    const { clock, deps } = makeClock(100);
    const ended = vi.fn();
    clock.events.on('ended', ended);
    clock.play();
    deps.advance(5000);
    expect(clock.currentFrame).toBe(99);
    expect(clock.isPlaying).toBe(false);
    expect(ended).toHaveBeenCalledOnce();
  });

  it('루프 구간에서 되감는다', () => {
    const { clock, deps } = makeClock(1000);
    clock.setLoop({ startFrame: 30, endFrame: 60 });
    clock.seek(30);
    clock.play();
    deps.advance(2000);
    expect(clock.currentFrame).toBeGreaterThanOrEqual(30);
    expect(clock.currentFrame).toBeLessThan(60);
    expect(clock.isPlaying).toBe(true);
  });

  it('프레임 스텝이 정확히 이동하고 재생을 멈춘다', () => {
    const { clock } = makeClock();
    clock.play();
    clock.step(10);
    expect(clock.isPlaying).toBe(false);
    expect(clock.currentFrame).toBe(10);
    clock.step(-1);
    expect(clock.currentFrame).toBe(9);
    for (let i = 0; i < 10; i += 1) clock.step(1);
    expect(clock.currentFrame).toBe(19);
  });

  it('구간을 벗어난 시크는 클램프된다', () => {
    const { clock } = makeClock(100);
    clock.seek(9999);
    expect(clock.currentFrame).toBe(99);
    clock.seek(-5);
    expect(clock.currentFrame).toBe(0);
  });

  it('정수가 아닌 시크는 거부한다', () => {
    const { clock } = makeClock();
    expect(() => clock.seek(1.5)).toThrowError();
  });
});

describe('SyncEngine.resolve', () => {
  const tl = populated();

  it('클립 끝 프레임은 다음 클립에 속한다 (exclusive)', () => {
    expect(resolve(tl, 299).videoClip!.id).toBe('v1');
    expect(resolve(tl, 300).videoClip!.id).toBe('v2');
  });

  it('소스 프레임을 정확히 매핑한다', () => {
    const p = resolve(tl, 50);
    expect(p.sourceFrame).toBe(150);
  });

  it('갭이면 isGap 이 참이다', () => {
    // v2 를 리플 없이 지우면 300~600 이 빈 구간이 된다.
    const withGap = applyCommand(tl, { type: 'removeClip', clipId: 'v2' }).next;
    const p = resolve(withGap, 450);
    expect(p.isGap).toBe(true);
    expect(p.sourceFrame).toBeNull();
  });

  it('자막 · 오버레이 · 오디오를 함께 푼다', () => {
    const p = resolve(tl, 10);
    expect(p.subtitleClips.map((c) => c.id)).toEqual(['s1']);
    expect(p.overlayClips.map((c) => c.id)).toEqual(['o1']);
    expect(p.audioClips.map((c) => c.id)).toEqual(['a1']);
  });

  it('뮤트된 오디오 트랙은 빠진다', () => {
    const muted = applyCommand(tl, { type: 'setTrackFlag', trackId: 'A1', flag: 'muted', value: true }).next;
    expect(resolve(muted, 10).audioClips).toHaveLength(0);
  });

  it('솔로 트랙이 있으면 그 트랙만 들린다', () => {
    const solo = applyCommand(tl, { type: 'setTrackFlag', trackId: 'S1', flag: 'solo', value: true }).next;
    expect(resolve(solo, 10).audioClips).toHaveLength(0);
  });

  it('비활성 클립은 표시되지 않는다', () => {
    const off = applyCommand(tl, { type: 'setClipProps', clipId: 'v1', props: { enabled: false } }).next;
    expect(resolve(off, 10).isGap).toBe(true);
  });
});

describe('게인 · 페이드', () => {
  it('dB 를 선형 배율로 바꾼다', () => {
    expect(dbToLinear(0)).toBeCloseTo(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 2);
  });

  it('페이드 인/아웃이 경계에서 0 에 가깝다', () => {
    const clip = {
      id: 'c',
      trackId: 'A1',
      sourceId: 'src1',
      sourceInFrame: 0,
      sourceOutFrame: 100,
      startFrame: 0,
      enabled: true,
      label: 'c',
      fadeInFrames: 10,
      fadeOutFrames: 10,
    };
    expect(clipFadeGain(clip, 0)).toBe(0);
    expect(clipFadeGain(clip, 5)).toBeCloseTo(0.5);
    expect(clipFadeGain(clip, 50)).toBe(1);
    expect(clipFadeGain(clip, 99)).toBeCloseTo(0.1);
  });
});

describe('SyntheticVideoSource', () => {
  it('프레임 번호와 타임코드를 그린다', () => {
    const src = new SyntheticVideoSource({
      id: 'src1',
      durationFrames: 1000,
      fps: FPS_30,
      mediaId: 'calc-30',
      chapters: [{ id: 'c1', title: '도함수의 정의', startFrame: 0, endFrame: 500, level: 2 }],
    });
    const ctx = new RecordingCtx();
    src.draw(ctx, 317, { w: 1920, h: 1080 });
    const texts = ctx.texts();
    expect(texts).toContain('317');
    expect(texts).toContain('00:00:10:17');
    expect(texts).toContain('도함수의 정의');
    expect(src.presentedFrame()).toBe(317);
  });
});

describe('MockStreamController', () => {
  function make() {
    return new MockStreamController({
      fps: FPS_30,
      durationFrames: 30 * 600,
      keyframeIntervalFrames: 60,
      bandwidthKbps: 12000,
      seekLatencyMs: 250,
    });
  }

  it('로드 후 지연이 지나면 ready 가 된다', () => {
    const s = make();
    s.load();
    expect(s.getStatus().state).toBe('loading');
    s.tick(300);
    s.tick(100);
    expect(['ready', 'buffering']).toContain(s.getStatus().state);
  });

  it('버퍼가 재생 위치보다 앞서 쌓인다', () => {
    const s = make();
    s.load();
    s.tick(300);
    for (let i = 0; i < 20; i += 1) s.tick(100);
    expect(s.getStatus().bufferAheadFrames).toBeGreaterThan(30);
  });

  it('시크는 가까운 이전 키프레임을 돌려준다', () => {
    const s = make();
    s.load();
    s.tick(300);
    expect(s.seek(125)).toBe(120);
    expect(s.seek(180)).toBe(180);
  });

  it('대역폭이 낮으면 버퍼링에 머문다', () => {
    const s = make();
    s.load();
    s.tick(300);
    s.simulate({ bandwidthKbps: 100 });
    s.seek(0);
    s.tick(300);
    s.setPlayhead(600);
    s.tick(100);
    expect(s.getStatus().state).toBe('buffering');
  });

  it('화질을 고정하면 effectiveQuality 가 따라간다', () => {
    const s = make();
    s.load();
    s.setQuality('360p');
    expect(s.getStatus().effectiveQuality).toBe('360p');
    s.setQuality('auto');
    expect(s.getStatus().effectiveQuality).toBe('1080p');
  });

  it('시크 지연이 3초를 넘으면 seekTimeout 을 낸다', () => {
    const s = make();
    const spy = vi.fn();
    s.events.on('seekTimeout', spy);
    s.simulate({ seekLatencyMs: 5000 });
    s.load();
    s.tick(100);
    expect(spy).toHaveBeenCalled();
    expect(s.getStatus().state).toBe('error');
  });

  it('드롭 프레임을 누적한다', () => {
    const s = make();
    s.load();
    s.tick(300);
    s.simulate({ dropRate: 0.1 });
    for (let i = 0; i < 10; i += 1) s.tick(100);
    expect(s.getStatus().droppedFrames).toBeGreaterThan(0);
  });
});
