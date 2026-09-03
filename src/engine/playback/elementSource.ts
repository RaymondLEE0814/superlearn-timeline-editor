import { EngineError } from '../errors';
import { frameToSec, fpsToNumber } from '../timebase';
import type { Ctx2D, DrawSize } from '../render/ctx';
import type { Fps, Frame, Id, SourceKind } from '../types';
import type { VideoSource } from './sources';

interface VideoLike {
  currentTime: number;
  playbackRate: number;
  readyState: number;
  duration: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  requestVideoFrameCallback?(cb: (now: number, meta: { mediaTime: number }) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

export interface ElementSourceOptions {
  id: Id;
  element: VideoLike;
  fps: Fps;
  durationFrames: Frame;
  seekTimeoutMs?: number;
  onError?: (e: EngineError) => void;
}

/**
 * 실제 HTMLVideoElement 를 감싼 소스.
 * 브라우저는 프레임 정확 시크를 보장하지 않으므로
 * 정지 시에는 프레임 중앙(+0.5프레임)으로 시크하고,
 * 재생 시에는 requestVideoFrameCallback 의 mediaTime 으로 드리프트를 보정한다.
 */
export class ElementVideoSource implements VideoSource {
  readonly kind: SourceKind = 'file';
  readonly id: Id;
  readonly durationFrames: Frame;

  private el: VideoLike;
  private fps: Fps;
  private fpsNum: number;
  private seekTimeoutMs: number;
  private onError?: (e: EngineError) => void;
  private presented: Frame = 0;
  private rvfcHandle: number | null = null;
  private lastDriftFrames = 0;
  private seekFailures = 0;

  constructor(opts: ElementSourceOptions) {
    this.id = opts.id;
    this.el = opts.element;
    this.fps = opts.fps;
    this.fpsNum = fpsToNumber(opts.fps);
    this.durationFrames = opts.durationFrames;
    this.seekTimeoutMs = opts.seekTimeoutMs ?? 1500;
    this.onError = opts.onError;
  }

  get driftFrames(): number {
    return this.lastDriftFrames;
  }

  prepare(): Promise<void> {
    if (this.el.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ok = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new EngineError('MEDIA_LOAD_FAILED', '영상 소스를 로드하지 못했습니다.', { context: { id: this.id } }));
      };
      const cleanup = () => {
        this.el.removeEventListener('loadeddata', ok);
        this.el.removeEventListener('error', fail);
      };
      this.el.addEventListener('loadeddata', ok);
      this.el.addEventListener('error', fail);
    });
  }

  seekTo(sourceFrame: Frame): Promise<void> {
    // 프레임 경계에 정확히 걸치면 브라우저가 앞뒤 프레임을 오갈 수 있어 중앙으로 이동한다.
    const target = frameToSec(sourceFrame, this.fps) + 0.5 / this.fpsNum;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.el.removeEventListener('seeked', finish);
        clearTimeout(timer);
        this.presented = sourceFrame;
        resolve();
      };
      const timer = setTimeout(() => {
        if (done) return;
        this.seekFailures += 1;
        this.onError?.(
          new EngineError('SEEK_TIMEOUT', `시크가 ${this.seekTimeoutMs}ms 안에 끝나지 않았습니다.`, {
            context: { id: this.id, sourceFrame, failures: this.seekFailures },
          }),
        );
        finish();
      }, this.seekTimeoutMs);
      this.el.addEventListener('seeked', finish);
      this.el.currentTime = target;
    });
  }

  presentedFrame(): Frame {
    return this.presented;
  }

  /** 재생 중 드리프트 보정을 시작한다. expectedFrame 은 마스터 클럭이 알려 준 값. */
  startSync(getExpectedSourceFrame: () => Frame | null): void {
    if (!this.el.requestVideoFrameCallback) {
      // 폴백: currentTime 만으로 근사 보정
      return;
    }
    const step = (_now: number, meta: { mediaTime: number }) => {
      const expected = getExpectedSourceFrame();
      if (expected != null) {
        const actual = meta.mediaTime * this.fpsNum;
        this.presented = Math.floor(actual);
        this.lastDriftFrames = actual - expected;
        this.correct();
      }
      this.rvfcHandle = this.el.requestVideoFrameCallback!(step);
    };
    this.rvfcHandle = this.el.requestVideoFrameCallback(step);
  }

  private correct(): void {
    const d = this.lastDriftFrames;
    if (Math.abs(d) > 3) {
      // 크게 벌어지면 재생 속도 보정으로는 못 따라잡으므로 다시 시크한다.
      this.el.currentTime -= d / this.fpsNum;
      this.el.playbackRate = 1;
      return;
    }
    if (Math.abs(d) > 0.5) this.el.playbackRate = d > 0 ? 0.98 : 1.02;
    else this.el.playbackRate = 1;
  }

  stopSync(): void {
    if (this.rvfcHandle != null && this.el.cancelVideoFrameCallback) {
      this.el.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.rvfcHandle = null;
    this.el.playbackRate = 1;
  }

  draw(ctx: Ctx2D, _sourceFrame: Frame, size: DrawSize): void {
    if (ctx.drawImage) ctx.drawImage(this.el, 0, 0, size.w, size.h);
  }

  dispose(): void {
    this.stopSync();
    this.el.pause();
  }
}
