import { Emitter } from '../events/emitter';
import { assertFrame, clampFrame, fpsToNumber } from '../timebase';
import type { Fps, Frame, FrameRange, PlaybackRate } from '../types';

export interface ClockDeps {
  now(): number;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
}

export interface ClockEvents extends Record<string, unknown> {
  frame: { frame: Frame };
  state: { isPlaying: boolean; rate: PlaybackRate };
  ended: { frame: Frame };
}

/**
 * 프레임 단위 마스터 클럭.
 * 미디어 위치를 실수 초로 들고 있으면 반올림 오차가 누적되므로,
 * 정수 앵커 프레임 + 벽시계 경과 시간으로 매 틱 프레임을 다시 계산한다.
 */
export class MasterClock {
  readonly events = new Emitter<ClockEvents>();

  private fps: Fps;
  private fpsNum: number;
  private durationFrames: Frame;
  private frame: Frame = 0;
  private playing = false;
  private playRate: PlaybackRate = 1;
  private loopRange: FrameRange | null = null;

  private anchorFrame: Frame = 0;
  private anchorTimeMs = 0;
  private rafId: number | null = null;

  constructor(
    fps: Fps,
    durationFrames: Frame,
    private deps: ClockDeps,
  ) {
    this.fps = fps;
    this.fpsNum = fpsToNumber(fps);
    this.durationFrames = Math.max(0, durationFrames);
  }

  get currentFrame(): Frame {
    return this.frame;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get rate(): PlaybackRate {
    return this.playRate;
  }
  get loop(): FrameRange | null {
    return this.loopRange;
  }
  get duration(): Frame {
    return this.durationFrames;
  }

  setDuration(durationFrames: Frame): void {
    assertFrame(durationFrames, 'durationFrames');
    this.durationFrames = Math.max(0, durationFrames);
    if (this.frame > this.lastFrame()) this.seek(this.lastFrame());
  }

  setFps(fps: Fps): void {
    this.fps = fps;
    this.fpsNum = fpsToNumber(fps);
    this.reanchor();
  }

  getFps(): Fps {
    return this.fps;
  }

  setLoop(range: FrameRange | null): void {
    this.loopRange = range;
    this.reanchor();
  }

  private lastFrame(): Frame {
    return Math.max(0, this.durationFrames - 1);
  }

  private reanchor(): void {
    this.anchorFrame = this.frame;
    this.anchorTimeMs = this.deps.now();
  }

  private setFrame(next: Frame): void {
    if (next === this.frame) return;
    this.frame = next;
    this.events.emit('frame', { frame: next });
  }

  play(): void {
    if (this.playing || this.durationFrames === 0) return;
    // 끝에서 재생을 누르면 처음부터 다시 시작한다.
    if (this.frame >= this.lastFrame() && !this.loopRange) this.setFrame(0);
    this.playing = true;
    this.reanchor();
    this.events.emit('state', { isPlaying: true, rate: this.playRate });
    this.schedule();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.rafId !== null) {
      this.deps.cancelFrame(this.rafId);
      this.rafId = null;
    }
    this.events.emit('state', { isPlaying: false, rate: this.playRate });
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setRate(rate: PlaybackRate): void {
    if (rate === this.playRate) return;
    this.playRate = rate;
    this.reanchor();
    this.events.emit('state', { isPlaying: this.playing, rate });
  }

  seek(frame: Frame): void {
    assertFrame(frame, 'frame');
    const clamped = clampFrame(frame, 0, this.lastFrame());
    this.setFrame(clamped);
    this.reanchor();
  }

  step(delta: number): void {
    assertFrame(delta, 'delta');
    if (this.playing) this.pause();
    this.seek(this.frame + delta);
  }

  private schedule(): void {
    this.rafId = this.deps.requestFrame(() => {
      this.rafId = null;
      if (!this.playing) return;
      this.tick();
      if (this.playing) this.schedule();
    });
  }

  /** 테스트에서 직접 호출할 수 있도록 공개한다. */
  tick(): void {
    if (!this.playing) return;
    const elapsedMs = this.deps.now() - this.anchorTimeMs;
    const advanced = Math.floor((elapsedMs / 1000) * this.playRate * this.fpsNum);
    let next = this.anchorFrame + advanced;

    const loop = this.loopRange;
    if (loop && loop.endFrame > loop.startFrame) {
      if (next >= loop.endFrame) {
        const span = loop.endFrame - loop.startFrame;
        next = loop.startFrame + ((next - loop.startFrame) % span);
        this.setFrame(next);
        this.reanchor();
        return;
      }
      if (next < loop.startFrame) next = loop.startFrame;
    }

    if (next > this.lastFrame()) {
      this.setFrame(this.lastFrame());
      this.pause();
      this.events.emit('ended', { frame: this.frame });
      return;
    }
    this.setFrame(next);
  }

  dispose(): void {
    this.pause();
    this.events.clear();
  }
}

/** 브라우저용 기본 의존성. rAF 가 없으면 setTimeout 으로 대체한다. */
export function browserClockDeps(): ClockDeps {
  const g = globalThis as unknown as {
    performance?: { now(): number };
    requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const hasRaf = typeof g.requestAnimationFrame === 'function';
  return {
    now: () => (g.performance ? g.performance.now() : Date.now()),
    requestFrame: (cb) =>
      hasRaf ? g.requestAnimationFrame!(() => cb()) : (setTimeout(cb, 16) as unknown as number),
    cancelFrame: (id) =>
      hasRaf ? g.cancelAnimationFrame!(id) : clearTimeout(id as unknown as NodeJS.Timeout),
  };
}

/** 테스트용 수동 시계. */
export class FakeClockDeps implements ClockDeps {
  private t = 0;
  private queue: Array<() => void> = [];
  private nextId = 1;

  now(): number {
    return this.t;
  }
  requestFrame(cb: () => void): number {
    this.queue.push(cb);
    return this.nextId++;
  }
  cancelFrame(): void {
    this.queue = [];
  }
  /** ms 만큼 시간을 진행시키고 예약된 콜백을 한 번 실행한다. */
  advance(ms: number): void {
    this.t += ms;
    const q = this.queue;
    this.queue = [];
    for (const cb of q) cb();
  }
}
