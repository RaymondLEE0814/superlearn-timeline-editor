import { fpsToNumber } from '../../engine/timebase';
import type { Quality } from '../../engine/types';
import { useUiStore } from '../../store/uiStore';
import { useRequiredSession } from '../servicesContext';

const QUALITIES: Quality[] = ['auto', '360p', '720p', '1080p'];

const STATE_LABEL: Record<string, string> = {
  idle: '대기',
  loading: '불러오는 중',
  ready: '재생 준비됨',
  buffering: '버퍼링',
  error: '오류',
};

export function StreamStatusBar() {
  const session = useRequiredSession();
  const stream = useUiStore((s) => s.stream);
  if (!stream) return null;

  const fps = fpsToNumber(session.meta.stream.fps);
  const aheadSec = stream.bufferAheadFrames / fps;
  const dot =
    stream.state === 'ready'
      ? 'bg-green-500'
      : stream.state === 'buffering' || stream.state === 'loading'
        ? 'bg-amber-500'
        : stream.state === 'error'
          ? 'bg-coral'
          : 'bg-gray-300';

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] text-gray-600">
      <span className="flex items-center gap-1.5" data-testid="stream-state">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        스트리밍: {STATE_LABEL[stream.state] ?? stream.state}
      </span>

      <label className="flex items-center gap-1">
        화질
        <select
          className="rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px]"
          value={stream.quality}
          onChange={(e) => session.stream.setQuality(e.target.value as Quality)}
          data-testid="quality-select"
        >
          {QUALITIES.map((q) => (
            <option key={q} value={q}>
              {q === 'auto' ? `자동 (${stream.effectiveQuality})` : q}
            </option>
          ))}
        </select>
      </label>

      <span className="font-mono">버퍼 {aheadSec.toFixed(1)}s</span>
      <span className="font-mono text-gray-400">
        키프레임 {(stream.keyframeIntervalFrames / fps).toFixed(0)}s · 시크 지연{' '}
        {stream.seekLatencyMs}ms
      </span>
      {stream.droppedFrames > 0 ? (
        <span className="font-mono text-coral">드롭 {stream.droppedFrames}</span>
      ) : null}

      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="rounded border border-gray-300 bg-white px-1.5 py-0.5"
          onClick={() => session.stream.simulate({ bandwidthKbps: 600 })}
          title="느린 회선을 흉내 냅니다"
        >
          저속 회선
        </button>
        <button
          type="button"
          className="rounded border border-gray-300 bg-white px-1.5 py-0.5"
          onClick={() => session.stream.simulate({ bandwidthKbps: 12000, dropRate: 0 })}
        >
          정상 회선
        </button>
      </span>
    </div>
  );
}
