import { clipEnd } from '../../engine/timeline/model';
import { useEditorStore } from '../../store/editorStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { useUiStore } from '../../store/uiStore';
import { Button, Toggle } from '../common';
import { useRequiredSession } from '../servicesContext';

export function TimelineToolbar() {
  const session = useRequiredSession();
  const timeline = useEditorStore((s) => s.timeline);
  const selected = useEditorStore((s) => s.selectedClipIds);
  const dispatch = useEditorStore((s) => s.dispatch);
  const undoAction = useEditorStore((s) => s.undoAction);
  const redoAction = useEditorStore((s) => s.redoAction);
  const history = useEditorStore((s) => s.history);
  const issues = useEditorStore((s) => s.issues);

  const frame = usePlaybackStore((s) => s.frame);
  const zoom = useUiStore((s) => s.zoom);
  const setZoom = useUiStore((s) => s.setZoom);
  const snap = useUiStore((s) => s.snapEnabled);
  const toggleSnap = useUiStore((s) => s.toggleSnap);
  const ripple = useUiStore((s) => s.rippleEnabled);
  const toggleRipple = useUiStore((s) => s.toggleRipple);
  const notify = useUiStore((s) => s.notify);

  const canSplit =
    timeline != null &&
    timeline.tracks.some((t) =>
      t.clips.some((c) => frame > c.startFrame && frame < clipEnd(c)),
    );

  const splitAtPlayhead = () => {
    if (!timeline) return;
    const video = timeline.tracks.find((t) => t.kind === 'video');
    const target = video?.clips.find((c) => frame > c.startFrame && frame < clipEnd(c));
    if (!target) {
      notify('플레이헤드가 클립 안에 있어야 분할할 수 있습니다.');
      return;
    }
    dispatch({ type: 'splitClip', clipId: target.id, atFrame: frame });
  };

  const deleteSelected = (rippleDelete: boolean) => {
    if (selected.length === 0) {
      notify('삭제할 클립을 선택하세요.');
      return;
    }
    for (const id of selected) dispatch({ type: 'removeClip', clipId: id, ripple: rippleDelete });
    useEditorStore.getState().selectClips([]);
  };

  const addMarker = () => {
    dispatch({
      type: 'addMarker',
      marker: {
        id: `mk_user_${frame}`,
        frame,
        label: `마커 ${frame}`,
        color: '#0A84FF',
        kind: 'user',
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-1.5">
      <span className="text-[11px] font-bold tracking-wide text-coral uppercase">타임라인</span>

      <Button size="sm" onClick={splitAtPlayhead} disabled={!canSplit} title="분할 (S)">
        분할
      </Button>
      <Button
        size="sm"
        onClick={() => deleteSelected(false)}
        disabled={selected.length === 0}
        title="삭제 (Delete)"
      >
        삭제
      </Button>
      <Button
        size="sm"
        onClick={() => deleteSelected(true)}
        disabled={selected.length === 0}
        title="리플 삭제 (Shift+Delete)"
      >
        리플 삭제
      </Button>
      <Button size="sm" onClick={addMarker} title="마커 추가 (M)">
        마커
      </Button>

      <div className="ml-2 flex items-center gap-3">
        <Toggle label="스냅" checked={snap} onChange={toggleSnap} testId="toggle-snap" />
        <Toggle label="리플" checked={ripple} onChange={toggleRipple} testId="toggle-ripple" />
      </div>

      <div className="ml-2 flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setZoom(zoom / 1.6)} title="축소 (−)">
          −
        </Button>
        <input
          type="range"
          min={-4}
          max={5}
          step={0.05}
          value={Math.log2(zoom)}
          onChange={(e) => setZoom(2 ** Number(e.target.value))}
          className="w-28 accent-[#FF3B30]"
          aria-label="줌"
        />
        <Button size="sm" variant="ghost" onClick={() => setZoom(zoom * 1.6)} title="확대 (+)">
          +
        </Button>
        <span className="w-14 font-mono text-[10px] text-gray-400">{zoom.toFixed(2)}x</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {issues.length > 0 ? (
          <span className="mr-2 rounded bg-coral-50 px-2 py-0.5 text-[10px] text-coral">
            유효성 오류 {issues.length}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={undoAction}
          disabled={history.past.length === 0}
          title="실행 취소 (Ctrl+Z)"
          testId="btn-undo"
        >
          ↶ 취소
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={redoAction}
          disabled={history.future.length === 0}
          title="다시 실행 (Ctrl+Shift+Z)"
          testId="btn-redo"
        >
          ↷ 다시
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const dur = usePlaybackStore.getState().duration;
            if (dur > 0) setZoom((window.innerWidth - 220) / ((dur / 30) * 20));
          }}
          title="전체 맞춤 (Shift+Z)"
        >
          전체 맞춤
        </Button>
        <span className="ml-2 font-mono text-[10px] text-gray-400">
          {session.meta.stream.width}×{session.meta.stream.height}
        </span>
      </div>
    </div>
  );
}
