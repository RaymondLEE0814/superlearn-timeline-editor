import { Emitter } from '../events/emitter';
import { floorToKeyframe, fpsToNumber } from '../timebase';
import type { EffectiveQuality, Fps, Frame, FrameRange, Quality, StreamStatus } from '../types';

const BITRATE_KBPS: Record<EffectiveQuality, number> = {
  '360p': 800,
  '720p': 2500,
  '1080p': 5000,
};

export interface StreamEvents extends Record<string, unknown> {
  status: StreamStatus;
  seekTimeout: { frame: Frame };
}

export interface StreamOptions {
  fps: Fps;
  durationFrames: Frame;
  keyframeIntervalFrames: number;
  bufferAheadSec?: number;
  seekLatencyMs?: number;
  bandwidthKbps?: number;
}

/**
 * 실시간 스트리밍 제어 목업.
 * HLS 유사 모델(세그먼트 6초 · 키프레임 2초)로 버퍼 · 화질 · 시크 지연을 시뮬레이션한다.
 * 실연동 시 이 클래스를 hls.js 어댑터로 교체한다. 외부에 노출하는 상태 모양은 그대로 둔다.
 */
export class MockStreamController {
  readonly events = new Emitter<StreamEvents>();

  private fps: Fps;
  private fpsNum: number;
  private durationFrames: Frame;
  private keyframeIntervalFrames: number;
  private bufferAheadFrames: Frame;
  private seekLatencyMs: number;
  private bandwidthKbps: number;

  private state: StreamStatus['state'] = 'idle';
  private quality: Quality = 'auto';
  private bufferStart: Frame = 0;
  private bufferEnd: Frame = 0;
  private playhead: Frame = 0;
  private pendingSeekMs = 0;
  private pendingSeekTarget: Frame | null = null;
  /** 소수점 이하가 버려지지 않도록 실수로 누적하고 표시할 때만 내림한다. */
  private droppedAccum = 0;
  private dropRate = 0;

  constructor(opts: StreamOptions) {
    this.fps = opts.fps;
    this.fpsNum = fpsToNumber(opts.fps);
    this.durationFrames = opts.durationFrames;
    this.keyframeIntervalFrames = Math.max(1, opts.keyframeIntervalFrames);
    this.bufferAheadFrames = Math.round((opts.bufferAheadSec ?? 12) * this.fpsNum);
    this.seekLatencyMs = opts.seekLatencyMs ?? 250;
    this.bandwidthKbps = opts.bandwidthKbps ?? 12000;
  }

  getStatus(): StreamStatus {
    return {
      state: this.state,
      quality: this.quality,
      effectiveQuality: this.effectiveQuality(),
      bufferedRanges: this.bufferedRanges(),
      bufferAheadFrames: Math.max(0, this.bufferEnd - this.playhead),
      seekLatencyMs: this.seekLatencyMs,
      bandwidthKbps: this.bandwidthKbps,
      droppedFrames: Math.floor(this.droppedAccum),
      keyframeIntervalFrames: this.keyframeIntervalFrames,
    };
  }

  private bufferedRanges(): FrameRange[] {
    if (this.bufferEnd <= this.bufferStart) return [];
    return [{ startFrame: this.bufferStart, endFrame: this.bufferEnd }];
  }

  private effectiveQuality(): EffectiveQuality {
    if (this.quality !== 'auto') return this.quality;
    const usable = this.bandwidthKbps * 0.8;
    if (usable >= BITRATE_KBPS['1080p']) return '1080p';
    if (usable >= BITRATE_KBPS['720p']) return '720p';
    return '360p';
  }

  private emit(): void {
    this.events.emit('status', this.getStatus());
  }

  private setState(s: StreamStatus['state']): void {
    if (this.state === s) return;
    this.state = s;
    this.emit();
  }

  load(): void {
    this.setState('loading');
    this.bufferStart = 0;
    this.bufferEnd = 0;
    this.pendingSeekMs = this.seekLatencyMs;
    this.pendingSeekTarget = 0;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    // 화질 전환은 버퍼를 비우고 현재 위치부터 다시 채운다.
    this.seek(this.playhead);
    this.emit();
  }

  simulate(opts: { bandwidthKbps?: number; dropRate?: number; seekLatencyMs?: number }): void {
    if (opts.bandwidthKbps != null) this.bandwidthKbps = Math.max(1, opts.bandwidthKbps);
    if (opts.dropRate != null) this.dropRate = Math.max(0, Math.min(1, opts.dropRate));
    if (opts.seekLatencyMs != null) this.seekLatencyMs = Math.max(0, opts.seekLatencyMs);
    this.emit();
  }

  /** 시크 후 실제로 재생이 시작될 수 있는 프레임(가까운 이전 키프레임). */
  seek(frame: Frame): Frame {
    const target = floorToKeyframe(Math.max(0, frame), this.keyframeIntervalFrames);
    this.playhead = frame;
    this.bufferStart = target;
    this.bufferEnd = target;
    this.pendingSeekMs = this.seekLatencyMs;
    this.pendingSeekTarget = target;
    this.setState('loading');
    return target;
  }

  setPlayhead(frame: Frame): void {
    this.playhead = frame;
    if (this.state === 'ready' && (frame < this.bufferStart || frame > this.bufferEnd)) {
      this.seek(frame);
    }
  }

  /** 앱의 rAF 루프에서 호출한다. dtMs 만큼 다운로드가 진행된 것으로 본다. */
  tick(dtMs: number): void {
    if (this.state === 'idle' || this.state === 'error') return;

    if (this.pendingSeekMs > 0) {
      this.pendingSeekMs -= dtMs;
      if (this.pendingSeekMs > 0) {
        // 지연이 3초를 넘으면 시크 실패로 본다.
        if (this.seekLatencyMs > 3000) {
          this.events.emit('seekTimeout', { frame: this.pendingSeekTarget ?? this.playhead });
          this.setState('error');
        }
        return;
      }
      this.pendingSeekMs = 0;
      this.pendingSeekTarget = null;
      this.setState('buffering');
    }

    // 대역폭 대비 비트레이트 비율만큼 실시간보다 빠르게(또는 느리게) 받는다.
    const ratio = this.bandwidthKbps / BITRATE_KBPS[this.effectiveQuality()];
    const grown = (dtMs / 1000) * this.fpsNum * ratio;
    this.bufferEnd = Math.min(this.durationFrames, this.bufferEnd + grown);

    if (this.dropRate > 0) {
      this.droppedAccum += (dtMs / 1000) * this.fpsNum * this.dropRate;
    }

    const ahead = this.bufferEnd - this.playhead;
    if (this.playhead < this.bufferStart) {
      this.seek(this.playhead);
      return;
    }
    if (ahead <= 0) this.setState('buffering');
    else if (this.state === 'buffering' && ahead >= Math.min(this.bufferAheadFrames, 2 * this.fpsNum)) {
      this.setState('ready');
    } else if (this.state === 'loading') {
      this.setState('ready');
    } else {
      this.emit();
    }
  }

  getFps(): Fps {
    return this.fps;
  }

  dispose(): void {
    this.events.clear();
  }
}
