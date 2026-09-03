import { EngineError, errorBus } from '../engine/errors';
import { MasterClock, browserClockDeps } from '../engine/playback/clock';
import { SyntheticVideoSource, type VideoSource } from '../engine/playback/sources';
import { MockStreamController } from '../engine/playback/stream';
import { AudioMixer, browserAudioContextFactory } from '../engine/render/audio';
import { Compositor } from '../engine/render/compositor';
import type { Ctx2D } from '../engine/render/ctx';
import { RenderService, type RenderTarget } from '../engine/render/job';
import type { Id, MediaMetadata, SourceRef } from '../engine/types';
import { usePlaybackStore } from '../store/playbackStore';
import { useUiStore } from '../store/uiStore';

const STREAM_UI_INTERVAL_MS = 250;

/**
 * 편집 세션의 명령형 부품(클럭 · 스트리밍 · 합성기 · 믹서 · 렌더러)을 한곳에 모아
 * React 밖에서 돌린다. 컴포넌트는 스토어로 상태만 구독한다.
 */
export class EditorSession {
  readonly clock: MasterClock;
  readonly stream: MockStreamController;
  readonly compositor: Compositor;
  readonly mixer: AudioMixer;
  readonly render: RenderService;
  readonly sources = new Map<Id, VideoSource>();
  readonly meta: MediaMetadata;

  private rafId: number | null = null;
  private lastTickMs = 0;
  private lastStreamPush = 0;
  private disposed = false;

  constructor(meta: MediaMetadata, source: SourceRef | null, durationFrames: number) {
    this.meta = meta;
    this.clock = new MasterClock(meta.stream.fps, durationFrames, browserClockDeps());
    this.stream = new MockStreamController({
      fps: meta.stream.fps,
      durationFrames: meta.stream.durationFrames,
      keyframeIntervalFrames: meta.stream.keyframeIntervalFrames,
    });

    // 소스를 못 받았으면 합성 소스로 대체해 편집을 계속할 수 있게 한다.
    const sourceId = source?.id ?? `src_${meta.mediaId}`;
    this.sources.set(
      sourceId,
      new SyntheticVideoSource({
        id: sourceId,
        durationFrames: meta.stream.durationFrames,
        fps: meta.stream.fps,
        mediaId: meta.mediaId,
        chapters: meta.chapters,
      }),
    );

    const slideTitles = new Map(meta.slides.map((s) => [s.imageRef, s.title] as const));
    this.compositor = new Compositor({
      sources: this.sources,
      fps: meta.stream.fps,
      resolveOverlayLabel: (ref) => slideTitles.get(ref) ?? ref,
    });

    this.mixer = new AudioMixer(browserAudioContextFactory(), (e) => errorBus.report(e));
    this.render = new RenderService({
      compositor: this.compositor,
      createTarget: (w, h) => createRenderTarget(w, h),
      makeBlob: (text, type) => new Blob([text], { type }),
      now: () => performance.now(),
      schedule: (cb) => {
        // 렌더가 UI 를 멈추지 않도록 다음 프레임으로 넘긴다.
        requestAnimationFrame(() => cb());
      },
    });
  }

  start(): void {
    this.clock.events.on('frame', ({ frame }) => {
      usePlaybackStore.getState().setFrame(frame);
      this.stream.setPlayhead(frame);
    });
    this.clock.events.on('state', ({ isPlaying, rate }) => {
      usePlaybackStore.getState().setPlaying(isPlaying);
      usePlaybackStore.getState().setRate(rate);
      if (!isPlaying) this.mixer.stopAll();
    });
    this.stream.events.on('seekTimeout', ({ frame }) => {
      errorBus.report(
        new EngineError('SEEK_TIMEOUT', '스트리밍 시크가 응답하지 않습니다.', { context: { frame } }),
      );
    });

    this.stream.load();
    this.lastTickMs = performance.now();
    this.loop();
  }

  private loop = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(250, now - this.lastTickMs);
    this.lastTickMs = now;
    this.stream.tick(dt);

    if (now - this.lastStreamPush > STREAM_UI_INTERVAL_MS) {
      this.lastStreamPush = now;
      useUiStore.getState().setStream(this.stream.getStatus());
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    this.disposed = true;
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.clock.dispose();
    this.stream.dispose();
    this.mixer.dispose();
    for (const s of this.sources.values()) s.dispose();
    this.sources.clear();
  }
}

function createRenderTarget(w: number, h: number): RenderTarget {
  const scale = Math.min(1, 640 / w);
  const width = Math.max(2, Math.round(w * scale));
  const height = Math.max(2, Math.round(h * scale));

  const g = globalThis as unknown as { OffscreenCanvas?: new (w: number, h: number) => unknown };
  if (g.OffscreenCanvas) {
    const canvas = new g.OffscreenCanvas(width, height) as unknown as {
      getContext(t: '2d'): Ctx2D | null;
    };
    const ctx = canvas.getContext('2d');
    if (ctx) return { ctx, size: { w: width, h: height } };
  }
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) {
    throw new EngineError('RENDER_FAILED', '2D 컨텍스트를 만들 수 없습니다.');
  }
  return { ctx: ctx as unknown as Ctx2D, size: { w: width, h: height } };
}
