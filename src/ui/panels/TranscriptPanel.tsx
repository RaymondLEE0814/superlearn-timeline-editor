import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock } from '../../engine/timebase';
import { useEditorStore } from '../../store/editorStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { useUiStore } from '../../store/uiStore';
import { Button } from '../common';
import { useRequiredSession } from '../servicesContext';
import { currentSourceFrame, seekSourceFrame } from './seek';

export function TranscriptPanel() {
  const session = useRequiredSession();
  const meta = useEditorStore((s) => s.meta);
  const timeline = useEditorStore((s) => s.timeline);
  const selection = useEditorStore((s) => s.transcriptSelection);
  const toggle = useEditorStore((s) => s.toggleTranscript);
  const setSelection = useEditorStore((s) => s.setTranscriptSelection);
  const clearSelection = useEditorStore((s) => s.clearTranscriptSelection);
  const runAutoEdit = useEditorStore((s) => s.runAutoEdit);
  const notify = useUiStore((s) => s.notify);
  const setPanel = useUiStore((s) => s.setPanel);
  const frame = usePlaybackStore((s) => s.frame);

  const [follow, setFollow] = useState(true);
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const srcFrame = currentSourceFrame(timeline, frame);
  const segments = useMemo(() => meta?.transcript.segments ?? [], [meta]);

  const activeIndex = useMemo(() => {
    if (srcFrame == null) return -1;
    return segments.findIndex((s) => srcFrame >= s.startFrame && srcFrame < s.endFrame);
  }, [segments, srcFrame]);

  useEffect(() => {
    if (!follow || activeIndex < 0) return;
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, follow]);

  if (!meta) return null;

  const onRowClick = (index: number, shiftKey: boolean) => {
    const seg = segments[index];
    if (shiftKey && lastIndex != null) {
      const [a, b] = index < lastIndex ? [index, lastIndex] : [lastIndex, index];
      const ids = segments.slice(a, b + 1).map((s) => s.id);
      setSelection([...new Set([...selection, ...ids])]);
      return;
    }
    setLastIndex(index);
    seekSourceFrame(session, timeline, seg.startFrame);
  };

  const generate = () => {
    if (selection.length === 0) {
      notify('먼저 자막 구간을 선택하세요.');
      return;
    }
    runAutoEdit('from-selection');
    setPanel('autoedit');
    notify(`선택한 ${selection.length}개 구간으로 타임라인을 만들었습니다.`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2">
        <Button size="sm" onClick={() => clearSelection()} disabled={selection.length === 0}>
          전체 강의
        </Button>
        <Button size="sm" variant="primary" onClick={generate} testId="btn-generate-selection">
          ✂ 선택 영역으로 생성
        </Button>
        <label className="ml-auto flex items-center gap-1 text-[10px] text-gray-500">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
            className="h-3 w-3 accent-[#FF3B30]"
          />
          자동 스크롤
        </label>
      </div>

      <div className="flex items-center gap-2 bg-coral-50 px-3 py-1.5">
        <span className="text-[11px] font-semibold text-coral" data-testid="selection-count">
          구간 {selection.length}개 선택됨
        </span>
        {selection.length > 0 ? (
          <button
            type="button"
            className="ml-auto text-[10px] text-coral underline"
            onClick={clearSelection}
          >
            선택 해제
          </button>
        ) : null}
      </div>

      <ul ref={listRef} className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto" data-testid="transcript-list">
        {segments.map((seg, i) => (
          <li
            key={seg.id}
            data-index={i}
            className={`flex items-start gap-2 px-3 py-2 ${
              i === activeIndex ? 'bg-coral-50' : ''
            }`}
          >
            <input
              type="checkbox"
              checked={selection.includes(seg.id)}
              onChange={() => toggle(seg.id)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#FF3B30]"
              aria-label={`${seg.text} 선택`}
              data-testid={`transcript-check-${seg.id}`}
            />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={(e) => onRowClick(i, e.shiftKey)}
            >
              <span className="font-mono text-[10px] text-gray-400">
                {formatClock(seg.startFrame, meta.stream.fps)}
              </span>
              <p className={`text-[11px] ${i === activeIndex ? 'text-gray-900' : 'text-gray-600'}`}>
                {seg.text}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
