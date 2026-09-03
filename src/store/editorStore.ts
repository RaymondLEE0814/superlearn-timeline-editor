import { create } from 'zustand';
import { autoEdit } from '../engine/autoedit';
import { withRules } from '../engine/autoedit/rules';
import { errorBus, toEngineError } from '../engine/errors';
import type { Command } from '../engine/timeline/commands';
import {
  canRedo,
  canUndo,
  commit,
  emptyHistory,
  redo,
  undo,
  type HistoryState,
} from '../engine/timeline/history';
import { timelineDuration } from '../engine/timeline/model';
import { validateTimeline, type ValidationIssue } from '../engine/timeline/validate';
import type {
  AutoEditPreset,
  AutoEditReport,
  AutoEditRules,
  Id,
  MediaMetadata,
  Timeline,
} from '../engine/types';

export interface EditorState {
  lectureId: Id | null;
  meta: MediaMetadata | null;
  timeline: Timeline | null;
  history: HistoryState;
  report: AutoEditReport | null;
  rules: AutoEditRules | null;
  preset: AutoEditPreset;
  selectedClipIds: Id[];
  selectedMarkerId: Id | null;
  transcriptSelection: Id[];
  issues: ValidationIssue[];
  dirty: boolean;

  init(lectureId: Id, meta: MediaMetadata, timeline: Timeline | null): void;
  dispatch(cmd: Command, coalesceKey?: string): boolean;
  undoAction(): void;
  redoAction(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  replaceTimeline(timeline: Timeline, label: string): void;
  runAutoEdit(preset: AutoEditPreset, partial?: Partial<AutoEditRules>): void;
  setRules(partial: Partial<AutoEditRules>): void;
  selectClips(ids: Id[]): void;
  toggleClip(id: Id, additive: boolean): void;
  selectMarker(id: Id | null): void;
  setTranscriptSelection(ids: Id[]): void;
  toggleTranscript(id: Id): void;
  clearTranscriptSelection(): void;
  markSaved(): void;
  duration(): number;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  lectureId: null,
  meta: null,
  timeline: null,
  history: emptyHistory(),
  report: null,
  rules: null,
  preset: 'silence-trim',
  selectedClipIds: [],
  selectedMarkerId: null,
  transcriptSelection: [],
  issues: [],
  dirty: false,

  init(lectureId, meta, timeline) {
    set({
      lectureId,
      meta,
      timeline,
      history: emptyHistory(),
      rules: withRules(meta.stream.fps),
      report: null,
      selectedClipIds: [],
      selectedMarkerId: null,
      transcriptSelection: [],
      issues: timeline ? validateTimeline(timeline) : [],
      dirty: false,
    });
  },

  dispatch(cmd, coalesceKey) {
    const { timeline, history } = get();
    if (!timeline) return false;
    try {
      const r = commit(timeline, history, cmd, coalesceKey);
      if (r.timeline === timeline) return false;
      set({
        timeline: r.timeline,
        history: r.history,
        issues: validateTimeline(r.timeline),
        dirty: true,
      });
      return true;
    } catch (e) {
      errorBus.report(toEngineError(e));
      return false;
    }
  },

  undoAction() {
    const { timeline, history } = get();
    if (!timeline) return;
    const r = undo(timeline, history);
    set({ timeline: r.timeline, history: r.history, issues: validateTimeline(r.timeline), dirty: true });
  },

  redoAction() {
    const { timeline, history } = get();
    if (!timeline) return;
    const r = redo(timeline, history);
    set({ timeline: r.timeline, history: r.history, issues: validateTimeline(r.timeline), dirty: true });
  },

  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),

  replaceTimeline(timeline, label) {
    get().dispatch({ type: 'replaceTimeline', timeline, label });
    set({ selectedClipIds: [], selectedMarkerId: null });
  },

  runAutoEdit(preset, partial) {
    const { meta, rules } = get();
    if (!meta) return;
    try {
      const merged = { ...(rules ?? {}), ...(partial ?? {}) } as Partial<AutoEditRules>;
      if (preset === 'from-selection') merged.selectedTranscriptIds = get().transcriptSelection;
      const result = autoEdit(meta, preset, merged);
      get().replaceTimeline(result.timeline, `자동 편집: ${preset}`);
      set({ report: result.report, rules: result.rulesUsed, preset });
    } catch (e) {
      errorBus.report(toEngineError(e));
    }
  },

  setRules(partial) {
    const { rules, meta } = get();
    if (!meta) return;
    set({ rules: withRules(meta.stream.fps, { ...(rules ?? {}), ...partial }) });
  },

  selectClips(ids) {
    set({ selectedClipIds: ids, selectedMarkerId: null });
  },

  toggleClip(id, additive) {
    const cur = get().selectedClipIds;
    if (!additive) {
      set({ selectedClipIds: [id], selectedMarkerId: null });
      return;
    }
    set({
      selectedClipIds: cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id],
      selectedMarkerId: null,
    });
  },

  selectMarker(id) {
    set({ selectedMarkerId: id, selectedClipIds: [] });
  },

  setTranscriptSelection(ids) {
    set({ transcriptSelection: ids });
  },

  toggleTranscript(id) {
    const cur = get().transcriptSelection;
    set({
      transcriptSelection: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    });
  },

  clearTranscriptSelection() {
    set({ transcriptSelection: [] });
  },

  markSaved() {
    set({ dirty: false });
  },

  duration() {
    const tl = get().timeline;
    return tl ? timelineDuration(tl) : 0;
  },
}));
