import { describe, expect, it, vi } from 'vitest';
import { autoEdit } from '../../src/engine/autoedit';
import { EngineError } from '../../src/engine/errors';
import { SyntheticVideoSource } from '../../src/engine/playback/sources';
import { Compositor } from '../../src/engine/render/compositor';
import { RecordingCtx } from '../../src/engine/render/ctx';
import { buildRenderGraph } from '../../src/engine/render/graph';
import { RenderService, type RenderDeps } from '../../src/engine/render/job';
import { cueCount, toSrt, toVtt } from '../../src/engine/render/subtitles';
import { FPS_30 } from '../../src/engine/timebase';
import { applyCommand } from '../../src/engine/timeline/commands';
import { DEFAULT_SUBTITLE_STYLE } from '../../src/engine/timeline/model';
import { generateLecture } from '../../src/mock/lectureGen';
import { SHORT_DEMO } from '../../src/mock/lectureSpecs';
import { populated } from './helpers';

const short = generateLecture(SHORT_DEMO);

describe('buildRenderGraph', () => {
  const tl = populated();

  it('영상 · 오버레이 · 자막 순서로 레이어를 쌓는다', () => {
    const c = buildRenderGraph(tl, 10);
    expect(c.layers.map((l) => l.kind)).toEqual(['video', 'overlay', 'subtitle']);
  });

  it('갭이면 gap 레이어만 남는다', () => {
    const withGap = applyCommand(tl, { type: 'removeClip', clipId: 'v2' }).next;
    const c = buildRenderGraph(withGap, 450);
    expect(c.layers[0].kind).toBe('gap');
    expect(c.audio).toHaveLength(0);
  });

  it('같은 프레임은 같은 해시를 준다', () => {
    expect(buildRenderGraph(tl, 10).hash).toBe(buildRenderGraph(tl, 10).hash);
    expect(buildRenderGraph(tl, 10).hash).not.toBe(buildRenderGraph(tl, 11).hash);
  });

  it('뮤트하면 오디오 레이어가 사라진다', () => {
    const muted = applyCommand(tl, { type: 'setTrackFlag', trackId: 'A1', flag: 'muted', value: true }).next;
    expect(buildRenderGraph(muted, 10).audio).toHaveLength(0);
  });

  it('게인과 페이드가 오디오 레이어에 반영된다', () => {
    const faded = applyCommand(tl, {
      type: 'setClipProps',
      clipId: 'a1',
      props: { fadeInFrames: 30, gain: -6 },
    }).next;
    const atStart = buildRenderGraph(faded, 0).audio[0];
    const mid = buildRenderGraph(faded, 100).audio[0];
    expect(atStart.gain).toBe(0);
    expect(mid.gain).toBeCloseTo(0.501, 2);
  });
});

describe('Compositor', () => {
  function makeCompositor() {
    const sources = new Map();
    sources.set(
      'src1',
      new SyntheticVideoSource({ id: 'src1', durationFrames: 10000, fps: FPS_30, mediaId: 'm1' }),
    );
    return new Compositor({ sources, fps: FPS_30 });
  }

  it('영상 프레임 번호와 타임라인 타임코드를 함께 그린다', () => {
    const tl = populated();
    const ctx = new RecordingCtx();
    makeCompositor().render(buildRenderGraph(tl, 50), ctx);
    const texts = ctx.texts();
    expect(texts).toContain('150');
    expect(texts).toContain('TL 00:00:01:20');
  });

  it('갭 프레임에 GAP 을 그린다', () => {
    const tl = applyCommand(populated(), { type: 'removeClip', clipId: 'v2' }).next;
    const ctx = new RecordingCtx();
    makeCompositor().render(buildRenderGraph(tl, 450), ctx);
    expect(ctx.texts()).toContain('GAP');
  });

  it('소스가 없으면 안내를 그리고 예외를 던지지 않는다', () => {
    const tl = populated();
    const ctx = new RecordingCtx();
    const c = new Compositor({ sources: new Map(), fps: FPS_30 });
    expect(() => c.render(buildRenderGraph(tl, 10), ctx)).not.toThrow();
    expect(ctx.texts().some((t) => t.includes('소스 없음'))).toBe(true);
  });

  it('자막을 두 줄까지 줄바꿈한다', () => {
    const tl = applyCommand(populated(), {
      type: 'setClipProps',
      clipId: 's1',
      props: {
        subtitle: {
          text: '도함수는 함수의 변화율로 이해할 수 있습니다 직관적으로는 입력값이 아주 조금 변할 때 함수값이 얼마나 변하는지를 나타냅니다',
          style: DEFAULT_SUBTITLE_STYLE,
        },
      },
    }).next;
    const ctx = new RecordingCtx();
    makeCompositor().render(buildRenderGraph(tl, 10), ctx);
    const subtitleLines = ctx.texts().filter((t) => t.includes('도함수는') || t.includes('…'));
    expect(subtitleLines.length).toBeGreaterThan(0);
    expect(subtitleLines.length).toBeLessThanOrEqual(2);
  });
});

describe('자막 내보내기', () => {
  const { timeline } = autoEdit(short, 'silence-trim');

  it('VTT 가 헤더와 큐를 갖는다', () => {
    const vtt = toVtt(timeline);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it('SRT 는 쉼표 구분자를 쓴다', () => {
    expect(toSrt(timeline)).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
  });

  it('큐 수가 자막 트랙 클립 수와 같다', () => {
    const s1 = timeline.tracks.find((t) => t.id === 'S1')!;
    expect(cueCount(timeline)).toBe(s1.clips.length);
  });

  it('큐 시작 시각이 클립 시작 프레임과 일치한다', () => {
    const s1 = timeline.tracks.find((t) => t.id === 'S1')!;
    const first = s1.clips[0];
    const expected = (first.startFrame / 25).toFixed(3);
    const vtt = toVtt(timeline);
    const stamp = vtt.split('\n')[3].split(' --> ')[0];
    const [h, m, s] = stamp.split(':');
    const sec = Number(h) * 3600 + Number(m) * 60 + Number(s);
    expect(sec.toFixed(3)).toBe(expected);
  });
});

describe('RenderService', () => {
  function deps(overrides?: Partial<RenderDeps>): RenderDeps {
    const sources = new Map();
    sources.set(
      `src_${short.mediaId}`,
      new SyntheticVideoSource({
        id: `src_${short.mediaId}`,
        durationFrames: short.stream.durationFrames,
        fps: short.stream.fps,
        mediaId: short.mediaId,
      }),
    );
    let t = 0;
    return {
      compositor: new Compositor({ sources, fps: short.stream.fps }),
      createTarget: () => ({ ctx: new RecordingCtx(), size: { w: 320, h: 180 } }),
      makeBlob: (text, type) => new Blob([text], { type }),
      now: () => (t += 10),
      schedule: (cb) => cb(),
      ...overrides,
    };
  }

  it('전체 프레임을 렌더하고 매니페스트 · 자막을 만든다', async () => {
    const { timeline } = autoEdit(short, 'silence-trim');
    const svc = new RenderService(deps());
    const progress: number[] = [];
    svc.events.on('progress', (p) => progress.push(p.frame));
    const handle = svc.startRender(timeline, {
      manifest: true,
      vtt: true,
      srt: true,
      captureWebm: false,
      framesPerTick: 500,
    });
    const out = await handle.result;
    expect(out.manifestJson).toBeInstanceOf(Blob);
    expect(out.subtitlesVtt).toBeInstanceOf(Blob);
    expect(out.subtitlesSrt).toBeInstanceOf(Blob);
    expect(progress.length).toBeGreaterThan(1);
    expect(svc.getJob(handle.jobId)!.state).toBe('done');
  });

  it('매니페스트가 타임라인과 클립 수를 담는다', async () => {
    const { timeline } = autoEdit(short, 'silence-trim');
    const svc = new RenderService(deps());
    const out = await svc.startRender(timeline, {
      manifest: true,
      vtt: false,
      srt: false,
      captureWebm: false,
      framesPerTick: 5000,
    }).result;
    const text = await out.manifestJson!.text();
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(1);
    expect(parsed.timeline.id).toBe(timeline.id);
    expect(parsed.stats.clipCount).toBe(
      timeline.tracks.reduce((n, t) => n + t.clips.length, 0),
    );
  });

  it('유효하지 않은 타임라인은 INVALID_TIMELINE 으로 거부한다', () => {
    const tl = populated();
    const broken = {
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id === 'V1'
          ? { ...t, clips: t.clips.map((c) => (c.id === 'v2' ? { ...c, startFrame: 100 } : c)) }
          : t,
      ),
    };
    const svc = new RenderService(deps());
    try {
      svc.startRender(broken, { manifest: true, vtt: false, srt: false, captureWebm: false });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe('INVALID_TIMELINE');
    }
  });

  it('취소하면 RENDER_ABORTED 이고 산출물이 없다', async () => {
    const { timeline } = autoEdit(short, 'silence-trim');
    const queue: Array<() => void> = [];
    const svc = new RenderService(deps({ schedule: (cb) => queue.push(cb) }));
    const cancelled = vi.fn();
    svc.events.on('cancelled', cancelled);
    const handle = svc.startRender(timeline, {
      manifest: true,
      vtt: false,
      srt: false,
      captureWebm: false,
      framesPerTick: 10,
    });
    queue.shift()!();
    handle.cancel();
    queue.shift()!();
    await expect(handle.result).rejects.toMatchObject({ code: 'RENDER_ABORTED' });
    expect(cancelled).toHaveBeenCalled();
    expect(svc.getJob(handle.jobId)!.outputs).toBeUndefined();
  });

  it('렌더 중 예외는 RENDER_FAILED 로 감싼다', async () => {
    const { timeline } = autoEdit(short, 'silence-trim');
    const svc = new RenderService(
      deps({
        createTarget: () => {
          throw new Error('캔버스를 만들 수 없습니다');
        },
      }),
    );
    const handle = svc.startRender(timeline, {
      manifest: true,
      vtt: false,
      srt: false,
      captureWebm: false,
    });
    await expect(handle.result).rejects.toMatchObject({ code: 'RENDER_FAILED' });
  });
});
