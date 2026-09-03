import { create } from 'zustand';
import { errorBus } from '../engine/errors';
import type { AnalysisStage, EngineErrorShape, Id, StreamStatus } from '../engine/types';

export type PanelTab = 'toc' | 'transcript' | 'autoedit' | 'inspector';

export interface Toast {
  id: string;
  message: string;
  severity: EngineErrorShape['severity'];
}

export interface UiState {
  panel: PanelTab;
  zoom: number;
  scrollFrame: number;
  snapEnabled: boolean;
  rippleEnabled: boolean;
  showProblems: boolean;
  showExport: boolean;
  problems: EngineErrorShape[];
  toasts: Toast[];
  analysis: { running: boolean; stage: AnalysisStage | null; pct: number; error: string | null };
  stream: StreamStatus | null;
  savedAt: string | null;
  timelineHeight: number;

  setPanel(p: PanelTab): void;
  setZoom(z: number): void;
  setScrollFrame(f: number): void;
  toggleSnap(): void;
  toggleRipple(): void;
  setShowProblems(v: boolean): void;
  setShowExport(v: boolean): void;
  pushProblem(e: EngineErrorShape): void;
  clearProblems(): void;
  dismissToast(id: string): void;
  setAnalysis(a: Partial<UiState['analysis']>): void;
  setStream(s: StreamStatus | null): void;
  setSavedAt(t: string | null): void;
  setTimelineHeight(h: number): void;
  notify(message: string, severity?: EngineErrorShape['severity']): void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set, get) => ({
  panel: 'toc',
  zoom: 1,
  scrollFrame: 0,
  snapEnabled: true,
  rippleEnabled: false,
  showProblems: false,
  showExport: false,
  problems: [],
  toasts: [],
  analysis: { running: false, stage: null, pct: 0, error: null },
  stream: null,
  savedAt: null,
  timelineHeight: 320,

  setPanel: (panel) => set({ panel }),
  setZoom: (zoom) => set({ zoom: Math.min(64, Math.max(0.02, zoom)) }),
  setScrollFrame: (scrollFrame) => set({ scrollFrame: Math.max(0, Math.round(scrollFrame)) }),
  toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
  toggleRipple: () => set({ rippleEnabled: !get().rippleEnabled }),
  setShowProblems: (showProblems) => set({ showProblems }),
  setShowExport: (showExport) => set({ showExport }),

  pushProblem(e) {
    set({ problems: [...get().problems, e].slice(-200) });
    if (e.severity === 'error' || e.severity === 'fatal') {
      get().notify(e.message, e.severity);
    }
  },

  clearProblems: () => set({ problems: [] }),

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setAnalysis: (a) => set({ analysis: { ...get().analysis, ...a } }),
  setStream: (stream) => set({ stream }),
  setSavedAt: (savedAt) => set({ savedAt }),
  setTimelineHeight: (h) => set({ timelineHeight: Math.min(560, Math.max(200, h)) }),

  notify(message, severity = 'info') {
    const id = `t${++toastSeq}`;
    set({ toasts: [...get().toasts, { id, message, severity }] });
    setTimeout(() => get().dismissToast(id), 3200);
  },
}));

/** 엔진 오류 버스를 UI 문제 로그에 연결한다. 앱 시작 시 한 번만 호출한다. */
let wired = false;
export function wireErrorBus(): void {
  if (wired) return;
  wired = true;
  errorBus.subscribe((shape) => useUiStore.getState().pushProblem(shape));
}

export type { Id };
