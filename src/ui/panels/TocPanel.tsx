import { useMemo, useState } from 'react';
import { formatClock } from '../../engine/timebase';
import type { Chapter } from '../../engine/types';
import { useEditorStore } from '../../store/editorStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { Button } from '../common';
import { useRequiredSession } from '../servicesContext';
import { currentSourceFrame, seekSourceFrame } from './seek';

type Scope = 'full' | 'current';

export function TocPanel() {
  const session = useRequiredSession();
  const meta = useEditorStore((s) => s.meta);
  const timeline = useEditorStore((s) => s.timeline);
  const toggleTranscript = useEditorStore((s) => s.toggleTranscript);
  const transcriptSelection = useEditorStore((s) => s.transcriptSelection);
  const frame = usePlaybackStore((s) => s.frame);

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('full');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const srcFrame = currentSourceFrame(timeline, frame);

  const currentChapter = useMemo(() => {
    if (!meta || srcFrame == null) return null;
    const leaves = meta.chapters.filter((c) => !meta.chapters.some((o) => o.parentId === c.id));
    return leaves.find((c) => srcFrame >= c.startFrame && srcFrame < c.endFrame) ?? null;
  }, [meta, srcFrame]);

  const results = useMemo(() => {
    if (!meta || query.trim().length === 0) return null;
    const q = query.trim().toLowerCase();
    const inScope = (start: number) =>
      scope === 'full' ||
      (currentChapter != null && start >= currentChapter.startFrame && start < currentChapter.endFrame);

    const chapterHits = meta.chapters
      .filter((c) => c.title.toLowerCase().includes(q) && inScope(c.startFrame))
      .map((c) => ({ kind: 'chapter' as const, id: c.id, frame: c.startFrame, text: c.title }));

    const segmentHits = meta.transcript.segments
      .filter((s) => s.text.toLowerCase().includes(q) && inScope(s.startFrame))
      .slice(0, 60)
      .map((s) => ({ kind: 'segment' as const, id: s.id, frame: s.startFrame, text: s.text }));

    return [...chapterHits, ...segmentHits];
  }, [meta, query, scope, currentChapter]);

  if (!meta) return null;

  const tops = meta.chapters.filter((c) => c.level === 1);
  const childrenOf = (parent: Chapter) => meta.chapters.filter((c) => c.parentId === parent.id);

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 p-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="주제 검색 · 자막 키워드 검색"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
          data-testid="toc-search"
        />
        {query ? (
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" active={scope === 'full'} onClick={() => setScope('full')}>
              전체 강의
            </Button>
            <Button size="sm" active={scope === 'current'} onClick={() => setScope('current')}>
              현재 주제
            </Button>
            <span className="ml-auto text-[10px] text-gray-400" data-testid="search-count">
              {results?.length ?? 0} results · {transcriptSelection.length} segments selected
            </span>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {results ? (
          <ul className="divide-y divide-gray-100" data-testid="search-results">
            {results.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-start gap-2 px-3 py-2">
                {r.kind === 'segment' ? (
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-[#FF3B30]"
                    checked={transcriptSelection.includes(r.id)}
                    onChange={() => toggleTranscript(r.id)}
                    aria-label="구간 선택"
                  />
                ) : (
                  <span className="mt-0.5 text-[10px] text-coral">장</span>
                )}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => seekSourceFrame(session, timeline, r.frame)}
                >
                  <span className="font-mono text-[10px] text-gray-400">
                    {formatClock(r.frame, meta.stream.fps)}
                  </span>
                  <p className="truncate text-[11px] text-gray-700">{r.text}</p>
                </button>
              </li>
            ))}
            {results.length === 0 ? (
              <li className="px-3 py-4 text-[11px] text-gray-400">검색 결과가 없습니다.</li>
            ) : null}
          </ul>
        ) : (
          <ul className="py-1" data-testid="toc-tree">
            {tops.map((top) => {
              const kids = childrenOf(top);
              const isOpen = !collapsed.has(top.id);
              return (
                <li key={top.id}>
                  <div className="flex items-center gap-1 px-2">
                    {kids.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleCollapse(top.id)}
                        className="w-4 text-[10px] text-gray-400"
                        aria-label={isOpen ? '접기' : '펼치기'}
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="w-4" />
                    )}
                    <button
                      type="button"
                      onClick={() => seekSourceFrame(session, timeline, top.startFrame)}
                      className={`flex flex-1 items-center justify-between px-1 py-1.5 text-left text-[11px] ${
                        currentChapter?.id === top.id || currentChapter?.parentId === top.id
                          ? 'font-semibold text-coral'
                          : 'text-gray-700'
                      }`}
                      data-testid={`toc-${top.id}`}
                    >
                      <span className="truncate">{top.title}</span>
                      <span className="ml-2 font-mono text-[10px] text-gray-400">
                        {formatClock(top.endFrame - top.startFrame, meta.stream.fps)}
                      </span>
                    </button>
                  </div>
                  {isOpen
                    ? kids.map((k) => (
                        <button
                          key={k.id}
                          type="button"
                          onClick={() => seekSourceFrame(session, timeline, k.startFrame)}
                          className={`flex w-full items-center justify-between py-1 pr-3 pl-8 text-left text-[11px] ${
                            currentChapter?.id === k.id
                              ? 'bg-coral-50 font-semibold text-coral'
                              : 'text-gray-600 hover:bg-gray-50'
                          }`}
                          data-testid={`toc-${k.id}`}
                        >
                          <span className="truncate">{k.title}</span>
                          <span className="ml-2 font-mono text-[10px] text-gray-400">
                            {formatClock(k.endFrame - k.startFrame, meta.stream.fps)}
                          </span>
                        </button>
                      ))
                    : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
