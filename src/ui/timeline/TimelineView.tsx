import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { formatClock } from '../../engine/timebase';
import { clipEnd, timelineDuration } from '../../engine/timeline/model';
import { snapCandidates } from '../../engine/timeline/query';
import type { Track, TrackKind } from '../../engine/types';
import { useEditorStore } from '../../store/editorStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { useUiStore } from '../../store/uiStore';
import { useRequiredSession } from '../servicesContext';
import { ClipView, type DragMode } from './ClipView';
import { TimelineToolbar } from './TimelineToolbar';
import { WaveformLane } from './WaveformLane';
import { pxPerFrame, pxToFrame, tickStepSec, visibleRange } from './geometry';

const RULER_H = 26;
const BUFFER_H = 6;
const LANE_H: Record<TrackKind, number> = { video: 56, overlay: 34, subtitle: 34, audio: 56 };
const SNAP_TOLERANCE_PX = 8;

interface DragState {
  mode: DragMode;
  clipId: string;
  startX: number;
  deltaFrames: number;
}

export function TimelineView() {
  const session = useRequiredSession();
  const timeline = useEditorStore((s) => s.timeline);
  const selected = useEditorStore((s) => s.selectedClipIds);
  const issues = useEditorStore((s) => s.issues);
  const dispatch = useEditorStore((s) => s.dispatch);
  const toggleClip = useEditorStore((s) => s.toggleClip);
  const selectMarker = useEditorStore((s) => s.selectMarker);

  const frame = usePlaybackStore((s) => s.frame);
  const inFrame = usePlaybackStore((s) => s.inFrame);
  const outFrame = usePlaybackStore((s) => s.outFrame);

  const zoom = useUiStore((s) => s.zoom);
  const setZoom = useUiStore((s) => s.setZoom);
  const snapEnabled = useUiStore((s) => s.snapEnabled);
  const rippleEnabled = useUiStore((s) => s.rippleEnabled);
  const stream = useUiStore((s) => s.stream);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewWidth, setViewWidth] = useState(1200);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [snapHint, setSnapHint] = useState<number | null>(null);

  const fps = timeline?.fps ?? session.meta.stream.fps;
  const ppf = pxPerFrame(fps, zoom);
  const duration = timeline ? timelineDuration(timeline) : 0;
  const totalPx = Math.max(viewWidth, (duration + 1) * ppf);

  const invalidClipIds = useMemo(
    () => new Set(issues.map((i) => i.clipId).filter(Boolean) as string[]),
    [issues],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth));
    ro.observe(el);
    setViewWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 재생 중에는 플레이헤드를 화면 안에 유지한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || drag) return;
    const x = frame * ppf;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 80) {
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.35);
    }
  }, [frame, ppf, drag]);

  const view = visibleRange(scrollLeft, viewWidth, fps, zoom, duration);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left + el.scrollLeft;
      session.clock.seek(Math.max(0, Math.min(duration, pxToFrame(px, fps, zoom))));
    },
    [session, duration, fps, zoom],
  );

  const onRulerPointerDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };
  const onRulerPointerMove = (e: ReactPointerEvent) => {
    if (e.buttons === 1) seekFromClientX(e.clientX);
  };

  const startDrag = (e: ReactPointerEvent, clipId: string, mode: DragMode) => {
    e.preventDefault();
    setDrag({ mode, clipId, startX: e.clientX, deltaFrames: 0 });
  };

  // 드래그 중에는 로컬 상태로만 미리보기를 그리고, 놓을 때 한 번만 명령을 커밋한다.
  useEffect(() => {
    if (!drag || !timeline) return;
    const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === drag.clipId);
    if (!clip) return;

    const onMove = (e: PointerEvent) => {
      const raw = Math.round((e.clientX - drag.startX) / ppf);
      let delta = raw;
      let hint: number | null = null;
      if (snapEnabled) {
        const anchor =
          drag.mode === 'trimEnd' ? clipEnd(clip) + raw : clip.startFrame + raw;
        const cand = snapCandidates(timeline, anchor, Math.round(SNAP_TOLERANCE_PX / ppf) + 1, {
          playhead: usePlaybackStore.getState().frame,
          excludeClipIds: new Set([clip.id, clip.linkedClipId ?? '']),
        });
        if (cand) {
          delta = raw + (cand.frame - anchor);
          hint = cand.frame;
        }
      }
      setSnapHint(hint);
      setDrag((d) => (d ? { ...d, deltaFrames: delta } : d));
    };

    const onUp = () => {
      const d = drag.deltaFrames;
      if (d !== 0) {
        if (drag.mode === 'move') {
          dispatch({
            type: 'moveClip',
            clipId: drag.clipId,
            startFrame: Math.max(0, clip.startFrame + d),
            ripple: rippleEnabled,
          });
        } else if (drag.mode === 'trimStart') {
          dispatch({ type: 'trimStart', clipId: drag.clipId, delta: d });
        } else {
          dispatch({ type: 'trimEnd', clipId: drag.clipId, delta: d });
        }
      }
      setDrag(null);
      setSnapHint(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, timeline, ppf, snapEnabled, rippleEnabled, dispatch]);

  const ghostFor = (clipId: string, linkedId?: string) => {
    if (!drag || (drag.clipId !== clipId && drag.clipId !== linkedId)) {
      return { delta: 0, trim: { start: 0, end: 0 } };
    }
    if (drag.mode === 'move') return { delta: drag.deltaFrames, trim: { start: 0, end: 0 } };
    if (drag.mode === 'trimStart')
      return { delta: 0, trim: { start: drag.deltaFrames, end: 0 } };
    return { delta: 0, trim: { start: 0, end: drag.deltaFrames } };
  };

  if (!timeline) {
    return (
      <div className="flex h-full flex-col">
        <TimelineToolbar />
        <div className="grid flex-1 place-items-center text-xs text-gray-400">
          자동 편집을 실행하거나 강의 자막에서 구간을 선택하세요.
        </div>
      </div>
    );
  }

  const stepSec = tickStepSec(zoom);
  const fpsNum = fps.num / fps.den;
  const ticks: number[] = [];
  const firstTick = Math.floor(view.startFrame / (stepSec * fpsNum)) * stepSec * fpsNum;
  for (let f = firstTick; f <= view.endFrame; f += stepSec * fpsNum) ticks.push(Math.round(f));

  return (
    <div className="flex h-full flex-col bg-white">
      <TimelineToolbar />
      <div className="flex min-h-0 flex-1">
        {/* 트랙 헤더 */}
        <div className="w-[120px] shrink-0 border-r border-gray-200 bg-gray-50">
          <div style={{ height: RULER_H + BUFFER_H }} className="border-b border-gray-200" />
          {timeline.tracks.map((t) => (
            <TrackHeader key={t.id} track={t} height={LANE_H[t.kind]} />
          ))}
        </div>

        {/* 스크롤 영역 */}
        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          onWheel={(e) => {
            if (e.ctrlKey) {
              e.preventDefault();
              setZoom(zoom * (e.deltaY > 0 ? 0.9 : 1.1));
            }
          }}
          data-testid="timeline-scroll"
        >
          <div className="relative" style={{ width: totalPx }}>
            {/* 룰러 */}
            <div
              className="relative cursor-ew-resize border-b border-gray-200 bg-gray-50"
              style={{ height: RULER_H }}
              onPointerDown={onRulerPointerDown}
              onPointerMove={onRulerPointerMove}
              onDoubleClick={(e) => {
                const el = scrollRef.current!;
                const px = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
                const f = pxToFrame(px, fps, zoom);
                dispatch({
                  type: 'addMarker',
                  marker: { id: `mk_user_${f}`, frame: f, label: `마커 ${f}`, color: '#0A84FF', kind: 'user' },
                });
              }}
              data-testid="timeline-ruler"
            >
              {ticks.map((f) => (
                <div key={f} className="absolute top-0 h-full" style={{ left: f * ppf }}>
                  <div className="h-2 w-px bg-gray-300" />
                  <span className="ml-1 font-mono text-[9px] text-gray-400">
                    {formatClock(f, fps)}
                  </span>
                </div>
              ))}
              {timeline.markers
                .filter((m) => m.frame >= view.startFrame && m.frame <= view.endFrame)
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    title={m.label}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      selectMarker(m.id);
                      session.clock.seek(m.frame);
                    }}
                    className="absolute bottom-0 -ml-1 h-2.5 w-2 rounded-t-sm"
                    style={{ left: m.frame * ppf, background: m.color }}
                    data-testid={`marker-${m.id}`}
                  />
                ))}
            </div>

            {/* 버퍼 바 */}
            <div className="relative bg-gray-100" style={{ height: BUFFER_H }}>
              {(stream?.bufferedRanges ?? []).map((r, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full bg-gray-400"
                  style={{ left: r.startFrame * ppf, width: Math.max(1, (r.endFrame - r.startFrame) * ppf) }}
                />
              ))}
            </div>

            {/* 트랙 레인 */}
            {timeline.tracks.map((track) => {
              const h = LANE_H[track.kind];
              const visible = track.clips.filter(
                (c) => clipEnd(c) >= view.startFrame && c.startFrame <= view.endFrame,
              );
              return (
                <div
                  key={track.id}
                  className={`relative border-b border-gray-100 ${track.locked ? 'bg-gray-50' : ''}`}
                  style={{ height: h }}
                  data-testid={`lane-${track.id}`}
                >
                  {track.kind === 'audio' ? (
                    <WaveformLane
                      meta={session.meta}
                      timeline={timeline}
                      zoom={zoom}
                      height={h}
                      totalPx={totalPx}
                    />
                  ) : null}
                  {visible.map((clip) => {
                    const g = ghostFor(clip.id, clip.linkedClipId);
                    return (
                      <ClipView
                        key={clip.id}
                        clip={clip}
                        kind={track.kind}
                        fps={fps}
                        zoom={zoom}
                        height={h}
                        selected={selected.includes(clip.id)}
                        invalid={invalidClipIds.has(clip.id)}
                        ghostDelta={g.delta}
                        ghostTrim={g.trim}
                        onPointerDown={startDrag}
                        onSelect={(e, id) => toggleClip(id, e.shiftKey)}
                      />
                    );
                  })}
                </div>
              );
            })}

            {/* In/Out 구간 */}
            {inFrame != null && outFrame != null && outFrame > inFrame ? (
              <div
                className="pointer-events-none absolute top-0 border-x-2 border-coral bg-coral/5"
                style={{ left: inFrame * ppf, width: (outFrame - inFrame) * ppf, bottom: 0 }}
              />
            ) : null}

            {/* 스냅 가이드 */}
            {snapHint != null ? (
              <div
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-blue-500"
                style={{ left: snapHint * ppf }}
              />
            ) : null}

            {/* 플레이헤드 */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-coral"
              style={{ left: frame * ppf }}
              data-testid="playhead"
            >
              <div className="-ml-1 h-2 w-2 rotate-45 bg-coral" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackHeader({ track, height }: { track: Track; height: number }) {
  const dispatch = useEditorStore((s) => s.dispatch);
  const flag = (f: 'muted' | 'solo' | 'locked') =>
    dispatch({ type: 'setTrackFlag', trackId: track.id, flag: f, value: !track[f] });

  return (
    <div
      className="flex flex-col justify-center gap-1 border-b border-gray-100 px-2"
      style={{ height }}
    >
      <span className="truncate text-[10px] font-semibold text-gray-600">{track.name}</span>
      <div className="flex gap-1">
        {(['muted', 'solo', 'locked'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => flag(f)}
            title={f === 'muted' ? '음소거' : f === 'solo' ? '솔로' : '잠금'}
            className={`h-4 w-5 rounded border text-[9px] ${
              track[f] ? 'border-coral bg-coral-50 text-coral' : 'border-gray-300 bg-white text-gray-400'
            }`}
            data-testid={`track-${track.id}-${f}`}
          >
            {f === 'muted' ? 'M' : f === 'solo' ? 'S' : 'L'}
          </button>
        ))}
      </div>
    </div>
  );
}
