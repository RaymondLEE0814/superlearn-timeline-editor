import { create } from 'zustand';
import type { Frame, FrameRange, PlaybackRate } from '../engine/types';

export interface PlaybackStoreState {
  frame: Frame;
  isPlaying: boolean;
  rate: PlaybackRate;
  inFrame: Frame | null;
  outFrame: Frame | null;
  loopEnabled: boolean;
  muted: boolean;
  duration: Frame;

  setFrame(f: Frame): void;
  setPlaying(v: boolean): void;
  setRate(r: PlaybackRate): void;
  setIn(f: Frame | null): void;
  setOut(f: Frame | null): void;
  toggleLoop(): void;
  toggleMuted(): void;
  setDuration(d: Frame): void;
  loopRange(): FrameRange | null;
}

export const usePlaybackStore = create<PlaybackStoreState>((set, get) => ({
  frame: 0,
  isPlaying: false,
  rate: 1,
  inFrame: null,
  outFrame: null,
  loopEnabled: false,
  muted: false,
  duration: 0,

  setFrame: (frame) => set({ frame }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setRate: (rate) => set({ rate }),
  setIn: (inFrame) => set({ inFrame }),
  setOut: (outFrame) => set({ outFrame }),
  toggleLoop: () => set({ loopEnabled: !get().loopEnabled }),
  toggleMuted: () => set({ muted: !get().muted }),
  setDuration: (duration) => set({ duration }),

  loopRange() {
    const { loopEnabled, inFrame, outFrame, duration } = get();
    if (!loopEnabled) return null;
    const a = inFrame ?? 0;
    const b = outFrame ?? duration;
    return b > a ? { startFrame: a, endFrame: b } : null;
  },
}));
