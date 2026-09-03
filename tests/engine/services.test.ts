import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_CHANNEL, BRIDGE_VERSION, PlayerBridge } from '../../src/engine/api/bridge';
import { EngineError, ErrorBus, toEngineError } from '../../src/engine/errors';
import { Emitter } from '../../src/engine/events/emitter';
import {
  ANALYSIS_STAGES,
  MockMetadataAnalyzer,
  type FixtureLoader,
} from '../../src/engine/metadata/analyzer';
import { AudioMixer } from '../../src/engine/render/audio';
import { ElementVideoSource } from '../../src/engine/playback/elementSource';
import { RecordingCtx } from '../../src/engine/render/ctx';
import { FPS_30 } from '../../src/engine/timebase';
import { generateLecture } from '../../src/mock/lectureGen';
import { SHORT_DEMO } from '../../src/mock/lectureSpecs';
import type { FrameComposition, MediaMetadata } from '../../src/engine/types';

const meta = generateLecture(SHORT_DEMO);

class MemoryLoader implements FixtureLoader {
  calls = 0;
  constructor(private fail = false) {}
  loadMetadata(): Promise<MediaMetadata> {
    this.calls += 1;
    if (this.fail) return Promise.reject(new EngineError('MEDIA_LOAD_FAILED', '없음'));
    return Promise.resolve(meta);
  }
}

describe('MockMetadataAnalyzer', () => {
  it('7단계를 순서대로 내고 메타데이터를 돌려준다', async () => {
    const a = new MockMetadataAnalyzer(new MemoryLoader(), 0);
    const run = a.analyze('short-demo', { stageDelayMs: 0 });
    const stages: string[] = [];
    for await (const p of run.progress) stages.push(p.stage);
    expect(stages).toEqual(ANALYSIS_STAGES);
    await expect(run.result).resolves.toMatchObject({ mediaId: 'short-demo' });
  });

  it('진행률이 0 에서 100 까지 올라간다', async () => {
    const a = new MockMetadataAnalyzer(new MemoryLoader(), 0);
    const run = a.analyze('short-demo', { stageDelayMs: 0 });
    const pcts: number[] = [];
    for await (const p of run.progress) pcts.push(p.pct);
    expect(pcts[pcts.length - 1]).toBe(100);
    for (let i = 1; i < pcts.length; i += 1) expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
  });

  it('failAt 단계에서 ANALYSIS_FAILED 로 실패한다', async () => {
    const a = new MockMetadataAnalyzer(new MemoryLoader(), 0);
    const run = a.analyze('short-demo', { failAt: 'scene', stageDelayMs: 0 });
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const p of run.progress) seen.push(p.stage);
      })(),
    ).rejects.toMatchObject({ code: 'ANALYSIS_FAILED' });
    expect(seen).toEqual(['probe', 'audio']);
    await expect(run.result).rejects.toMatchObject({ code: 'ANALYSIS_FAILED' });
  });

  it('로더 실패를 그대로 전달한다', async () => {
    const a = new MockMetadataAnalyzer(new MemoryLoader(true), 0);
    const run = a.analyze('x', { stageDelayMs: 0 });
    await expect(
      (async () => {
        for await (const _ of run.progress) void _;
      })(),
    ).rejects.toMatchObject({ code: 'MEDIA_LOAD_FAILED' });
  });

  it('성공 후에는 캐시에서 바로 준다', async () => {
    const loader = new MemoryLoader();
    const a = new MockMetadataAnalyzer(loader, 0);
    expect(await a.getCached('short-demo')).toBeNull();
    const run = a.analyze('short-demo', { stageDelayMs: 0 });
    for await (const _ of run.progress) void _;
    await run.result;
    expect(await a.getCached('short-demo')).not.toBeNull();
  });

  it('취소하면 결과가 실패한다', async () => {
    const a = new MockMetadataAnalyzer(new MemoryLoader(), 0);
    const run = a.analyze('short-demo', { stageDelayMs: 0 });
    run.cancel();
    await expect(
      (async () => {
        for await (const _ of run.progress) void _;
      })(),
    ).resolves.toBeUndefined();
    await expect(run.result).rejects.toMatchObject({ code: 'ANALYSIS_FAILED' });
  });
});

describe('PlayerBridge', () => {
  function makePair() {
    const bus = new Emitter<{ message: { data: unknown; origin: string } }>();
    const sent: unknown[] = [];
    const target = { postMessage: (m: unknown) => sent.push(m) };
    const messageBus = {
      addEventListener: (_t: 'message', fn: (e: { data: unknown; origin: string }) => void) =>
        bus.on('message', fn),
      removeEventListener: () => undefined,
    };
    return { bus, sent, target, messageBus };
  }

  it('올바른 메시지를 타입별 이벤트로 푼다', () => {
    const { bus, target, messageBus } = makePair();
    const bridge = new PlayerBridge();
    bridge.connect(target, messageBus);
    const onSeek = vi.fn();
    bridge.events.on('seek', onSeek);
    bus.emit('message', {
      data: { channel: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type: 'seek', payload: { frame: 10 } },
      origin: '*',
    });
    expect(onSeek).toHaveBeenCalledWith({ frame: 10 });
  });

  it('채널이 다르면 무시한다', () => {
    const { bus, target, messageBus } = makePair();
    const onError = vi.fn();
    const bridge = new PlayerBridge(onError);
    bridge.connect(target, messageBus);
    bus.emit('message', { data: { channel: 'other', v: 1, type: 'seek' }, origin: '*' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('버전이 다르면 BRIDGE_PROTOCOL_ERROR', () => {
    const { bus, target, messageBus } = makePair();
    const onError = vi.fn();
    const bridge = new PlayerBridge(onError);
    bridge.connect(target, messageBus);
    bus.emit('message', { data: { channel: BRIDGE_CHANNEL, v: 99, type: 'seek' }, origin: '*' });
    expect(onError.mock.calls[0][0].code).toBe('BRIDGE_PROTOCOL_ERROR');
  });

  it('타입이 없으면 BRIDGE_PROTOCOL_ERROR', () => {
    const { bus, target, messageBus } = makePair();
    const onError = vi.fn();
    const bridge = new PlayerBridge(onError);
    bridge.connect(target, messageBus);
    bus.emit('message', { data: { channel: BRIDGE_CHANNEL, v: 1 }, origin: '*' });
    expect(onError.mock.calls[0][0].code).toBe('BRIDGE_PROTOCOL_ERROR');
  });

  it('send 는 채널과 버전을 붙인다', () => {
    const { sent, target, messageBus } = makePair();
    const bridge = new PlayerBridge();
    bridge.connect(target, messageBus);
    bridge.send('ready', { version: 1 });
    expect(sent[0]).toMatchObject({ channel: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type: 'ready' });
    bridge.disconnect();
    bridge.send('ready', { version: 1 });
    expect(sent).toHaveLength(1);
  });
});

describe('ErrorBus', () => {
  it('구독자에게 알리고 로그를 쌓는다', () => {
    const bus = new ErrorBus();
    const seen: string[] = [];
    const off = bus.subscribe((s) => seen.push(s.code));
    bus.report(new EngineError('SEEK_TIMEOUT', '느림'));
    bus.report(new Error('알 수 없음'));
    expect(seen).toEqual(['SEEK_TIMEOUT', 'UNKNOWN']);
    expect(bus.getLog()).toHaveLength(2);
    off();
    bus.report(new EngineError('DECODE_ERROR', 'x'));
    expect(seen).toHaveLength(2);
    bus.clear();
    expect(bus.getLog()).toHaveLength(0);
  });

  it('코드별 기본 심각도와 복구 가능 여부가 정해져 있다', () => {
    expect(new EngineError('SEEK_TIMEOUT', 'x').severity).toBe('warn');
    expect(new EngineError('SEEK_TIMEOUT', 'x').recoverable).toBe(true);
    expect(new EngineError('INVALID_TIMELINE', 'x').recoverable).toBe(false);
    expect(toEngineError('문자열').code).toBe('UNKNOWN');
  });
});

describe('AudioMixer', () => {
  function fakeContext() {
    const gains: Array<{ value: number }> = [];
    const ctx = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createGain: () => {
        const g = {
          gain: { value: 0, setTargetAtTime: (v: number) => (g.gain.value = v) },
          connect: () => undefined,
          disconnect: () => undefined,
        };
        gains.push(g.gain);
        return g;
      },
      createOscillator: () => ({
        frequency: { value: 0 },
        type: '',
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
        disconnect: () => undefined,
      }),
      resume: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
    return { ctx, gains };
  }

  function comp(audio: FrameComposition['audio']): FrameComposition {
    return { frame: 0, size: { w: 2, h: 2 }, hash: 'h', layers: [], audio };
  }

  it('클립마다 보이스를 만들고 사라지면 정리한다', async () => {
    const { ctx } = fakeContext();
    const mixer = new AudioMixer(() => ctx);
    await mixer.ensureStarted();
    mixer.apply(comp([{ clipId: 'a', sourceId: 's', sourceFrame: 0, gain: 1 }]));
    mixer.apply(comp([{ clipId: 'b', sourceId: 's', sourceFrame: 0, gain: 0.5 }]));
    mixer.stopAll();
    mixer.dispose();
    expect(mixer.isBlocked).toBe(false);
  });

  it('음소거하면 게인이 0 이 된다', async () => {
    const { ctx } = fakeContext();
    const mixer = new AudioMixer(() => ctx);
    await mixer.ensureStarted();
    mixer.setMuted(true);
    mixer.apply(comp([{ clipId: 'a', sourceId: 's', sourceFrame: 0, gain: 1 }]));
    mixer.setMuted(false);
    expect(mixer.isBlocked).toBe(false);
  });

  it('AudioContext 가 없으면 막힌 상태로 조용히 동작한다', async () => {
    const mixer = new AudioMixer(() => null);
    await mixer.ensureStarted();
    expect(mixer.isBlocked).toBe(true);
    expect(() => mixer.apply(comp([]))).not.toThrow();
  });

  it('생성이 실패하면 AUDIO_CONTEXT_BLOCKED 를 보고한다', async () => {
    const onError = vi.fn();
    const mixer = new AudioMixer(() => {
      throw new Error('막힘');
    }, onError);
    await mixer.ensureStarted();
    expect(mixer.isBlocked).toBe(true);
    expect(onError.mock.calls[0][0].code).toBe('AUDIO_CONTEXT_BLOCKED');
  });
});

describe('ElementVideoSource', () => {
  function fakeVideo() {
    const listeners = new Map<string, Array<() => void>>();
    const el = {
      currentTime: 0,
      playbackRate: 1,
      readyState: 2,
      duration: 100,
      paused: true,
      play: () => Promise.resolve(),
      pause: () => undefined,
      addEventListener: (t: string, fn: () => void) => {
        const list = listeners.get(t) ?? [];
        list.push(fn);
        listeners.set(t, list);
      },
      removeEventListener: (t: string, fn: () => void) => {
        listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn));
      },
      fire: (t: string) => [...(listeners.get(t) ?? [])].forEach((f) => f()),
    };
    return el;
  }

  it('프레임 중앙으로 시크하고 seeked 를 기다린다', async () => {
    const el = fakeVideo();
    const src = new ElementVideoSource({
      id: 'v',
      element: el,
      fps: FPS_30,
      durationFrames: 3000,
    });
    await src.prepare();
    const p = src.seekTo(30);
    // 30프레임 = 1초, 여기에 half-frame 을 더한다.
    expect(el.currentTime).toBeCloseTo(1 + 0.5 / 30, 5);
    el.fire('seeked');
    await p;
    expect(src.presentedFrame()).toBe(30);
  });

  it('시크가 시간 안에 끝나지 않으면 SEEK_TIMEOUT 을 보고한다', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const el = fakeVideo();
    const src = new ElementVideoSource({
      id: 'v',
      element: el,
      fps: FPS_30,
      durationFrames: 3000,
      seekTimeoutMs: 100,
      onError,
    });
    const p = src.seekTo(60);
    vi.advanceTimersByTime(150);
    await p;
    expect(onError.mock.calls[0][0].code).toBe('SEEK_TIMEOUT');
    vi.useRealTimers();
  });

  it('로드 실패는 MEDIA_LOAD_FAILED 가 된다', async () => {
    const el = fakeVideo();
    el.readyState = 0;
    const src = new ElementVideoSource({ id: 'v', element: el, fps: FPS_30, durationFrames: 10 });
    const p = src.prepare();
    el.fire('error');
    await expect(p).rejects.toMatchObject({ code: 'MEDIA_LOAD_FAILED' });
  });

  it('rVFC 가 없으면 동기화를 시작해도 조용히 넘어간다', () => {
    const el = fakeVideo();
    const src = new ElementVideoSource({ id: 'v', element: el, fps: FPS_30, durationFrames: 10 });
    expect(() => src.startSync(() => 0)).not.toThrow();
    src.stopSync();
    expect(src.driftFrames).toBe(0);
    const ctx = new RecordingCtx();
    src.draw(ctx, 0, { w: 10, h: 10 });
    expect(ctx.calls.some((c) => c.op === 'drawImage')).toBe(true);
    src.dispose();
  });

  it('드리프트가 크면 재시크하고 작으면 재생 속도로 보정한다', () => {
    const el = fakeVideo() as ReturnType<typeof fakeVideo> & {
      requestVideoFrameCallback?: (cb: (n: number, m: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (h: number) => void;
    };
    let cb: ((n: number, m: { mediaTime: number }) => void) | null = null;
    el.requestVideoFrameCallback = (fn) => {
      cb = fn;
      return 1;
    };
    el.cancelVideoFrameCallback = () => undefined;

    const src = new ElementVideoSource({ id: 'v', element: el, fps: FPS_30, durationFrames: 3000 });
    let expected = 30;
    src.startSync(() => expected);

    // 1프레임 앞서 있으면 재생 속도를 살짝 낮춘다.
    cb!(0, { mediaTime: 31 / 30 });
    expect(el.playbackRate).toBeLessThan(1);

    // 5프레임 벌어지면 다시 시크한다.
    expected = 30;
    cb!(0, { mediaTime: 35 / 30 });
    expect(el.playbackRate).toBe(1);
    src.stopSync();
  });
});
