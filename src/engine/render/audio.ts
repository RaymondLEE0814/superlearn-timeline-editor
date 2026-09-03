import { EngineError } from '../errors';
import type { FrameComposition, Id } from '../types';

interface GainLike {
  gain: { value: number; setTargetAtTime(v: number, t: number, c: number): void };
  connect(dest: unknown): void;
  disconnect(): void;
}

interface OscLike {
  frequency: { value: number };
  type: string;
  connect(dest: unknown): void;
  start(): void;
  stop(): void;
  disconnect(): void;
}

interface AudioCtxLike {
  state: string;
  currentTime: number;
  destination: unknown;
  createGain(): GainLike;
  createOscillator(): OscLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/**
 * 다중 트랙 오디오 믹서.
 * 목업 소스에는 실제 오디오가 없으므로 클립마다 주파수가 다른 톤을 내어
 * 트랙 뮤트 · 솔로 · 게인 · 페이드가 실제로 동작하는지 귀로 확인할 수 있게 한다.
 */
export class AudioMixer {
  private ctx: AudioCtxLike | null = null;
  private master: GainLike | null = null;
  private voices = new Map<Id, { osc: OscLike; gain: GainLike }>();
  private blocked = false;
  private muted = false;

  constructor(
    private createContext: () => AudioCtxLike | null,
    private onError?: (e: EngineError) => void,
  ) {}

  get isBlocked(): boolean {
    return this.blocked;
  }

  /** 자동재생 정책 때문에 사용자 제스처 이후에만 호출해야 한다. */
  async ensureStarted(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
          this.blocked = false;
        } catch {
          this.blocked = true;
        }
      }
      return;
    }
    try {
      const ctx = this.createContext();
      if (!ctx) {
        this.blocked = true;
        return;
      }
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(ctx.destination);
      if (ctx.state === 'suspended') await ctx.resume();
      this.blocked = false;
    } catch (e) {
      this.blocked = true;
      this.onError?.(
        new EngineError('AUDIO_CONTEXT_BLOCKED', '브라우저가 오디오 재생을 막았습니다. 화면을 한 번 클릭하세요.', {
          context: { cause: String(e) },
        }),
      );
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.18;
  }

  /** 매 프레임의 오디오 레이어를 반영한다. 없어진 클립의 보이스는 정리한다. */
  apply(comp: FrameComposition): void {
    if (!this.ctx || !this.master || this.blocked) return;
    const ctx = this.ctx;
    const alive = new Set(comp.audio.map((a) => a.clipId));

    for (const [id, v] of this.voices) {
      if (alive.has(id)) continue;
      try {
        v.osc.stop();
        v.osc.disconnect();
        v.gain.disconnect();
      } catch {
        /* 이미 정리된 보이스는 무시한다. */
      }
      this.voices.delete(id);
    }

    for (const a of comp.audio) {
      let voice = this.voices.get(a.clipId);
      if (!voice) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        // 클립마다 다른 음정을 주어 컷이 귀로 구분되게 한다.
        const seed = [...a.clipId].reduce((s, ch) => s + ch.charCodeAt(0), 0);
        osc.frequency.value = 180 + (seed % 12) * 40;
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(this.master);
        osc.start();
        voice = { osc, gain };
        this.voices.set(a.clipId, voice);
      }
      const target = this.muted ? 0 : Math.max(0, Math.min(1, a.gain));
      voice.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.02);
    }
  }

  stopAll(): void {
    for (const [, v] of this.voices) {
      try {
        v.osc.stop();
        v.osc.disconnect();
        v.gain.disconnect();
      } catch {
        /* 이미 정리된 보이스는 무시한다. */
      }
    }
    this.voices.clear();
  }

  dispose(): void {
    this.stopAll();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}

/** 브라우저 AudioContext 생성기. 없으면 null 을 돌려 믹서가 무음으로 동작한다. */
export function browserAudioContextFactory(): () => AudioCtxLike | null {
  return () => {
    const g = globalThis as unknown as { AudioContext?: new () => AudioCtxLike };
    if (!g.AudioContext) return null;
    return new g.AudioContext();
  };
}
