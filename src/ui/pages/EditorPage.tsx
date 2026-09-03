import { useEffect, useRef, useState } from 'react';
import { autoEdit, sourceRefFromMeta } from '../../engine/autoedit';
import { errorBus, toEngineError } from '../../engine/errors';
import { timelineDuration } from '../../engine/timeline/model';
import type { MediaMetadata, SourceRef, Timeline } from '../../engine/types';
import { useBridge } from '../../hooks/useBridge';
import { useShortcuts } from '../../hooks/useShortcuts';
import { EditorSession } from '../../session/EditorSession';
import { useEditorStore } from '../../store/editorStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { useUiStore, type PanelTab } from '../../store/uiStore';
import { Button } from '../common';
import { ExportDialog } from '../app/ExportDialog';
import { AutoEditPanel } from '../panels/AutoEditPanel';
import { InspectorPanel } from '../panels/InspectorPanel';
import { TocPanel } from '../panels/TocPanel';
import { TranscriptPanel } from '../panels/TranscriptPanel';
import { PreviewCanvas } from '../player/PreviewCanvas';
import { StreamStatusBar } from '../player/StreamStatusBar';
import { TransportBar } from '../player/TransportBar';
import { SessionContext, useServices } from '../servicesContext';
import { TimelineView } from '../timeline/TimelineView';

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'toc', label: '목차' },
  { id: 'transcript', label: '강의 자막' },
  { id: 'autoedit', label: '자동 편집' },
  { id: 'inspector', label: '속성' },
];

export function EditorPage({ lectureId }: { lectureId: string }) {
  const services = useServices();
  const [session, setSession] = useState<EditorSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const panel = useUiStore((s) => s.panel);
  const setPanel = useUiStore((s) => s.setPanel);
  const setAnalysis = useUiStore((s) => s.setAnalysis);
  const setSavedAt = useUiStore((s) => s.setSavedAt);
  const timelineHeight = useUiStore((s) => s.timelineHeight);
  const setTimelineHeight = useUiStore((s) => s.setTimelineHeight);

  const timeline = useEditorStore((s) => s.timeline);
  const meta = useEditorStore((s) => s.meta);
  const dirty = useEditorStore((s) => s.dirty);
  const breadcrumbs = meta?.breadcrumbs ?? [];

  useShortcuts(session);
  useBridge(session);

  // 강의 로드 → 분석 → 저장된 프로젝트 복원 또는 자동 편집
  useEffect(() => {
    let cancelled = false;
    let created: EditorSession | null = null;
    setLoadError(null);
    setAnalysis({ running: true, stage: null, pct: 0, error: null });

    (async () => {
      try {
        let source: SourceRef | null = null;
        try {
          source = await services.media.getSource(lectureId);
        } catch (e) {
          // 소스 실패는 치명적이지 않다. 합성 소스로 대체하고 계속 편집한다.
          errorBus.report(toEngineError(e));
        }

        const run = services.analysis.analyze(lectureId);
        for await (const p of run.progress) {
          if (cancelled) return;
          setAnalysis({ running: true, stage: p.stage, pct: p.pct });
        }
        const loaded: MediaMetadata = await run.result;
        if (cancelled) return;
        setAnalysis({ running: false, stage: null, pct: 100 });

        const saved = await services.project.load(lectureId);
        // 저장된 프로젝트가 없으면 무음 제거 결과를 초기 타임라인으로 쓴다.
        const auto = saved
          ? null
          : autoEdit(loaded, 'silence-trim', undefined, source ?? sourceRefFromMeta(loaded));
        const initial: Timeline = saved ?? auto!.timeline;

        useEditorStore.getState().init(lectureId, loaded, initial);
        if (auto) useEditorStore.setState({ report: auto.report, rules: auto.rulesUsed });

        created = new EditorSession(loaded, source, timelineDuration(initial));
        created.start();
        usePlaybackStore.getState().setDuration(timelineDuration(initial));
        usePlaybackStore.getState().setFrame(0);
        if (!cancelled) setSession(created);
        void services.lms.reportEvent({
          verb: 'opened',
          lectureId,
          at: new Date().toISOString(),
        });
      } catch (e) {
        if (cancelled) return;
        const err = toEngineError(e);
        errorBus.report(err);
        setAnalysis({ running: false, error: err.message });
        setLoadError(err.message);
      }
    })();

    return () => {
      cancelled = true;
      created?.dispose();
      setSession(null);
    };
  }, [lectureId, services, setAnalysis, reloadKey]);

  // 타임라인 길이 변화를 클럭과 재생 스토어에 반영한다.
  useEffect(() => {
    if (!session || !timeline) return;
    const d = timelineDuration(timeline);
    session.clock.setDuration(d);
    usePlaybackStore.getState().setDuration(d);
  }, [session, timeline]);

  // 자동 저장: 5초 디바운스 + 페이지 이탈 시 즉시 저장
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!timeline || !dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void services.project.save(lectureId, timeline).then(() => {
        useEditorStore.getState().markSaved();
        setSavedAt(new Date().toLocaleTimeString('ko-KR'));
      });
    }, 5000);
    const flush = () => void services.project.save(lectureId, timeline);
    window.addEventListener('beforeunload', flush);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      window.removeEventListener('beforeunload', flush);
    };
  }, [timeline, dirty, lectureId, services, setSavedAt]);

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-coral">{loadError}</p>
        <Button onClick={() => setReloadKey((k) => k + 1)} variant="primary">
          다시 시도
        </Button>
      </div>
    );
  }

  if (!session || !meta) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-xs text-gray-500">강의를 분석하는 중입니다…</p>
        <AnalysisProgress />
      </div>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1">
          {/* 좌: 프리뷰 */}
          <section className="flex min-w-0 flex-[62] flex-col border-r border-gray-200 bg-white">
            <div className="truncate border-b border-gray-100 px-3 py-2 text-[11px] text-gray-500">
              {breadcrumbs.join(' › ')}
            </div>
            <div className="flex-1 overflow-auto p-3">
              <PreviewCanvas />
            </div>
            <TransportBar />
            <StreamStatusBar />
          </section>

          {/* 우: 패널 */}
          <aside className="flex min-w-0 flex-[38] flex-col bg-white">
            <div className="flex shrink-0 border-b border-gray-200">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPanel(t.id)}
                  className={`flex-1 border-b-2 px-2 py-2 text-[11px] ${
                    panel === t.id
                      ? 'border-coral font-semibold text-coral'
                      : 'border-transparent text-gray-500 hover:bg-gray-50'
                  }`}
                  data-testid={`tab-${t.id}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {panel === 'toc' ? <TocPanel /> : null}
              {panel === 'transcript' ? <TranscriptPanel /> : null}
              {panel === 'autoedit' ? <AutoEditPanel /> : null}
              {panel === 'inspector' ? <InspectorPanel /> : null}
            </div>
          </aside>
        </div>

        {/* 타임라인 높이 조절 손잡이 */}
        <div
          className="h-1.5 shrink-0 cursor-row-resize bg-gray-200 hover:bg-coral"
          onPointerDown={(e) => {
            const startY = e.clientY;
            const startH = timelineHeight;
            const move = (ev: PointerEvent) => setTimelineHeight(startH - (ev.clientY - startY));
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        />

        <section className="shrink-0 overflow-hidden" style={{ height: timelineHeight }}>
          <TimelineView />
        </section>
      </div>
      <ExportDialog />
    </SessionContext.Provider>
  );
}

function AnalysisProgress() {
  const analysis = useUiStore((s) => s.analysis);
  return (
    <div className="w-64">
      <div className="h-1 w-full rounded bg-gray-200">
        <div className="h-1 rounded bg-coral transition-[width]" style={{ width: `${analysis.pct}%` }} />
      </div>
      <p className="mt-1 text-center font-mono text-[10px] text-gray-400">
        {analysis.stage ?? 'probe'} · {analysis.pct}%
      </p>
    </div>
  );
}
