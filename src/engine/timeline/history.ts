import type { Timeline } from '../types';
import { applyCommand, type Command } from './commands';

export interface HistoryEntry {
  applied: Command;
  inverse: Command;
  label: string;
  coalesceKey?: string;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const MAX_HISTORY = 200;

/** 드래그 병합으로 만들어진 batch 임을 표시하는 내부 라벨. */
const COALESCE_LABEL = '__coalesce';

export function emptyHistory(): HistoryState {
  return { past: [], future: [] };
}

function labelOf(cmd: Command): string {
  switch (cmd.type) {
    case 'addClip':
      return '클립 추가';
    case 'removeClip':
      return cmd.ripple ? '리플 삭제' : '클립 삭제';
    case 'moveClip':
      return '클립 이동';
    case 'trimStart':
      return '시작 트림';
    case 'trimEnd':
      return '끝 트림';
    case 'splitClip':
      return '클립 분할';
    case 'setClipProps':
      return '속성 변경';
    case 'shiftClipIds':
      return '클립 이동';
    case 'addMarker':
      return '마커 추가';
    case 'removeMarker':
      return '마커 삭제';
    case 'moveMarker':
      return '마커 이동';
    case 'setTrackFlag':
      return '트랙 설정';
    case 'replaceTimeline':
      return cmd.label ?? '타임라인 교체';
    case 'batch':
      return cmd.label ?? '일괄 편집';
  }
}

export interface CommitResult {
  timeline: Timeline;
  history: HistoryState;
}

/**
 * 명령을 적용하고 히스토리에 쌓는다.
 * coalesceKey 가 직전 항목과 같으면 하나로 합친다(드래그 중 한 단계 유지).
 */
export function commit(
  timeline: Timeline,
  history: HistoryState,
  cmd: Command,
  coalesceKey?: string,
): CommitResult {
  const { next, applied, inverse } = applyCommand(timeline, cmd);
  if (next === timeline) return { timeline, history };

  const entry: HistoryEntry = { applied, inverse, label: labelOf(applied), coalesceKey };
  const last = history.past[history.past.length - 1];

  let past: HistoryEntry[];
  if (coalesceKey && last && last.coalesceKey === coalesceKey) {
    // 트림처럼 상대값 명령이 이어질 수 있으므로 누적 전체를 되돌려야 한다.
    // applied 는 실행 순서대로, inverse 는 역순으로 쌓는다.
    const mergedApplied: Command =
      last.applied.type === 'batch' && last.applied.label === COALESCE_LABEL
        ? { type: 'batch', commands: [...last.applied.commands, entry.applied], label: COALESCE_LABEL }
        : { type: 'batch', commands: [last.applied, entry.applied], label: COALESCE_LABEL };
    const mergedInverse: Command =
      last.inverse.type === 'batch' && last.inverse.label === COALESCE_LABEL
        ? { type: 'batch', commands: [entry.inverse, ...last.inverse.commands], label: COALESCE_LABEL }
        : { type: 'batch', commands: [entry.inverse, last.inverse], label: COALESCE_LABEL };
    past = [
      ...history.past.slice(0, -1),
      { applied: mergedApplied, inverse: mergedInverse, label: last.label, coalesceKey },
    ];
  } else {
    past = [...history.past, entry];
    if (past.length > MAX_HISTORY) past = past.slice(past.length - MAX_HISTORY);
  }

  const stamped: Timeline = { ...next, updatedAt: new Date().toISOString() };
  return { timeline: stamped, history: { past, future: [] } };
}

export function undo(timeline: Timeline, history: HistoryState): CommitResult {
  const entry = history.past[history.past.length - 1];
  if (!entry) return { timeline, history };
  const { next } = applyCommand(timeline, entry.inverse);
  return {
    timeline: { ...next, updatedAt: new Date().toISOString() },
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] },
  };
}

export function redo(timeline: Timeline, history: HistoryState): CommitResult {
  const entry = history.future[0];
  if (!entry) return { timeline, history };
  const { next } = applyCommand(timeline, entry.applied);
  return {
    timeline: { ...next, updatedAt: new Date().toISOString() },
    history: { past: [...history.past, entry], future: history.future.slice(1) },
  };
}

export function canUndo(history: HistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.future.length > 0;
}
