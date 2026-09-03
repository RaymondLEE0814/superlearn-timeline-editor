import { formatTimecode, parseTimecode } from '../../engine/timebase';
import { clipDuration, clipEnd, findClip, timelineDuration } from '../../engine/timeline/model';
import { useEditorStore } from '../../store/editorStore';
import { useUiStore } from '../../store/uiStore';
import { NumberField, Slider, Toggle } from '../common';

export function InspectorPanel() {
  const timeline = useEditorStore((s) => s.timeline);
  const selected = useEditorStore((s) => s.selectedClipIds);
  const selectedMarkerId = useEditorStore((s) => s.selectedMarkerId);
  const dispatch = useEditorStore((s) => s.dispatch);
  const issues = useEditorStore((s) => s.issues);
  const notify = useUiStore((s) => s.notify);

  if (!timeline) return <p className="p-3 text-[11px] text-gray-400">타임라인이 없습니다.</p>;

  const marker = selectedMarkerId
    ? timeline.markers.find((m) => m.id === selectedMarkerId)
    : undefined;

  if (marker) {
    return (
      <div className="space-y-3 p-3">
        <p className="text-[10px] font-bold tracking-wide text-gray-400 uppercase">마커</p>
        <label className="flex items-center justify-between gap-2 text-[11px] text-gray-700">
          라벨
          <input
            className="w-40 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]"
            value={marker.label}
            onChange={(e) =>
              dispatch({
                type: 'addMarker',
                marker: { ...marker, label: e.target.value },
              })
            }
          />
        </label>
        <NumberField
          label="프레임"
          value={marker.frame}
          onChange={(v) => dispatch({ type: 'moveMarker', markerId: marker.id, frame: Math.round(v) })}
        />
        <button
          type="button"
          className="text-[11px] text-coral underline"
          onClick={() => dispatch({ type: 'removeMarker', markerId: marker.id })}
        >
          마커 삭제
        </button>
      </div>
    );
  }

  if (selected.length === 0) {
    const clipCount = timeline.tracks.reduce((n, t) => n + t.clips.length, 0);
    return (
      <div className="space-y-2 p-3">
        <p className="text-[10px] font-bold tracking-wide text-gray-400 uppercase">타임라인 요약</p>
        <dl className="space-y-1 text-[11px] text-gray-600">
          <Row label="길이" value={formatTimecode(timelineDuration(timeline), timeline.fps)} />
          <Row label="클립" value={`${clipCount}개`} />
          <Row label="마커" value={`${timeline.markers.length}개`} />
          <Row label="해상도" value={`${timeline.width}×${timeline.height}`} />
          <Row
            label="유효성"
            value={issues.length === 0 ? '✓ 문제 없음' : `⚠ 오류 ${issues.length}건`}
          />
        </dl>
        {issues.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {issues.slice(0, 8).map((i, k) => (
              <li key={k} className="text-[10px] text-coral">
                {i.message}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="pt-2 text-[10px] text-gray-400">클립을 선택하면 속성을 편집할 수 있습니다.</p>
      </div>
    );
  }

  const found = findClip(timeline, selected[0]);
  if (!found) return <p className="p-3 text-[11px] text-gray-400">선택한 클립을 찾을 수 없습니다.</p>;
  const { clip, track } = found;

  const setProps = (props: Parameters<typeof dispatch>[0] extends never ? never : Record<string, unknown>) =>
    dispatch({ type: 'setClipProps', clipId: clip.id, props });

  const applyTc = (which: 'start', value: string) => {
    try {
      const target = parseTimecode(value, timeline.fps);
      if (which === 'start') {
        dispatch({ type: 'moveClip', clipId: clip.id, startFrame: target });
      }
    } catch {
      notify('타임코드 형식이 올바르지 않습니다. HH:MM:SS:FF');
    }
  };

  return (
    <div className="space-y-3 overflow-y-auto p-3" data-testid="inspector">
      <div>
        <p className="text-[10px] font-bold tracking-wide text-gray-400 uppercase">
          {track.name} · 클립
        </p>
        <input
          className="mt-1 w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]"
          value={clip.label}
          onChange={(e) => setProps({ label: e.target.value })}
          aria-label="클립 라벨"
        />
      </div>

      <dl className="space-y-1 text-[11px] text-gray-600">
        <Row label="시작" value={formatTimecode(clip.startFrame, timeline.fps)} editable
          onCommit={(v) => applyTc('start', v)} testId="inspector-start" />
        <Row label="끝" value={formatTimecode(clipEnd(clip), timeline.fps)} />
        <Row label="길이" value={formatTimecode(clipDuration(clip), timeline.fps)} testId="inspector-duration" />
        <Row label="소스 In" value={String(clip.sourceInFrame)} />
        <Row label="소스 Out" value={String(clip.sourceOutFrame)} />
      </dl>

      <Toggle label="활성" checked={clip.enabled} onChange={(v) => setProps({ enabled: v })} />

      {track.kind === 'audio' ? (
        <div className="space-y-2 border-t border-gray-100 pt-2">
          <Slider
            label="게인 (dB)"
            min={-24}
            max={12}
            step={0.5}
            value={clip.gain ?? 0}
            onChange={(v) => setProps({ gain: v })}
          />
          <NumberField
            label="페이드 인"
            value={clip.fadeInFrames ?? 0}
            onChange={(v) => setProps({ fadeInFrames: Math.max(0, Math.round(v)) })}
            suffix="F"
          />
          <NumberField
            label="페이드 아웃"
            value={clip.fadeOutFrames ?? 0}
            onChange={(v) => setProps({ fadeOutFrames: Math.max(0, Math.round(v)) })}
            suffix="F"
          />
        </div>
      ) : null}

      {clip.subtitle ? (
        <div className="space-y-2 border-t border-gray-100 pt-2">
          <p className="text-[10px] font-bold tracking-wide text-gray-400 uppercase">자막</p>
          <textarea
            className="h-20 w-full rounded border border-gray-300 p-1.5 text-[11px]"
            value={clip.subtitle.text}
            onChange={(e) =>
              setProps({ subtitle: { ...clip.subtitle!, text: e.target.value } })
            }
            aria-label="자막 텍스트"
          />
          <NumberField
            label="글자 크기"
            value={clip.subtitle.style.fontSizePx}
            onChange={(v) =>
              setProps({
                subtitle: { ...clip.subtitle!, style: { ...clip.subtitle!.style, fontSizePx: v } },
              })
            }
            suffix="px"
          />
          <label className="flex items-center justify-between text-[11px] text-gray-700">
            위치
            <select
              className="rounded border border-gray-300 px-1 py-0.5 text-[11px]"
              value={clip.subtitle.style.position}
              onChange={(e) =>
                setProps({
                  subtitle: {
                    ...clip.subtitle!,
                    style: { ...clip.subtitle!.style, position: e.target.value as 'bottom' | 'top' },
                  },
                })
              }
            >
              <option value="bottom">하단</option>
              <option value="top">상단</option>
            </select>
          </label>
        </div>
      ) : null}

      {clip.overlay ? (
        <div className="space-y-2 border-t border-gray-100 pt-2">
          <p className="text-[10px] font-bold tracking-wide text-gray-400 uppercase">오버레이</p>
          <Row label="종류" value={clip.overlay.kind} />
          <Slider
            label="불투명도"
            value={clip.overlay.opacity}
            onChange={(v) => setProps({ overlay: { ...clip.overlay!, opacity: v } })}
          />
        </div>
      ) : null}

      {clip.meta?.reasons?.length ? (
        <div className="border-t border-gray-100 pt-2">
          <p className="text-[10px] font-bold tracking-wide text-gray-400 uppercase">
            자동 편집 근거
          </p>
          <p className="mt-1 font-mono text-[10px] text-gray-500">
            점수 {(clip.meta.score ?? 0).toFixed(3)}
          </p>
          <ul className="mt-1 space-y-0.5">
            {clip.meta.reasons.map((r) => (
              <li key={r} className="text-[10px] text-gray-500">
                · {r}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  editable,
  onCommit,
  testId,
}: {
  label: string;
  value: string;
  editable?: boolean;
  onCommit?: (v: string) => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-gray-500">{label}</dt>
      {editable ? (
        <input
          defaultValue={value}
          key={value}
          onBlur={(e) => onCommit?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="w-28 rounded border border-gray-300 px-1 py-0.5 text-right font-mono text-[11px]"
          data-testid={testId}
        />
      ) : (
        <dd className="font-mono text-gray-800" data-testid={testId}>
          {value}
        </dd>
      )}
    </div>
  );
}
