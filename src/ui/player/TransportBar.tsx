import { formatTimecode } from '../../engine/timebase';
import { nextEdgeFrame } from '../../engine/timeline/query';
import type { PlaybackRate } from '../../engine/types';
import { useEditorStore } from '../../store/editorStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { Button } from '../common';
import { useRequiredSession } from '../servicesContext';

const RATES: PlaybackRate[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function TransportBar() {
  const session = useRequiredSession();
  const frame = usePlaybackStore((s) => s.frame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const rate = usePlaybackStore((s) => s.rate);
  const inFrame = usePlaybackStore((s) => s.inFrame);
  const outFrame = usePlaybackStore((s) => s.outFrame);
  const loopEnabled = usePlaybackStore((s) => s.loopEnabled);
  const muted = usePlaybackStore((s) => s.muted);
  const duration = usePlaybackStore((s) => s.duration);
  const setIn = usePlaybackStore((s) => s.setIn);
  const setOut = usePlaybackStore((s) => s.setOut);
  const toggleLoop = usePlaybackStore((s) => s.toggleLoop);
  const toggleMuted = usePlaybackStore((s) => s.toggleMuted);
  const timeline = useEditorStore((s) => s.timeline);

  const fps = timeline?.fps ?? session.meta.stream.fps;

  const applyLoop = () => {
    toggleLoop();
    // 토글 직후 상태를 다시 읽어 클럭에 반영한다.
    setTimeout(() => session.clock.setLoop(usePlaybackStore.getState().loopRange()), 0);
  };

  const jumpEdge = (dir: 1 | -1) => {
    if (!timeline) return;
    session.clock.seek(nextEdgeFrame(timeline, frame, dir));
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-3 py-2">
      <Button size="sm" onClick={() => session.clock.seek(0)} title="처음으로 (Home)">
        ⏮
      </Button>
      <Button size="sm" onClick={() => jumpEdge(-1)} title="이전 편집점 (↑)">
        ◀◀
      </Button>
      <Button size="sm" onClick={() => session.clock.step(-1)} title="1프레임 뒤로 (←)">
        ◀
      </Button>
      <Button
        size="sm"
        variant="primary"
        testId="btn-playpause"
        onClick={() => {
          void session.mixer.ensureStarted();
          session.clock.toggle();
        }}
        title="재생/정지 (Space)"
      >
        {isPlaying ? '⏸' : '▶'}
      </Button>
      <Button size="sm" onClick={() => session.clock.step(1)} title="1프레임 앞으로 (→)">
        ▶
      </Button>
      <Button size="sm" onClick={() => jumpEdge(1)} title="다음 편집점 (↓)">
        ▶▶
      </Button>
      <Button
        size="sm"
        onClick={() => session.clock.seek(Math.max(0, duration - 1))}
        title="끝으로 (End)"
      >
        ⏭
      </Button>

      <div className="ml-2 font-mono text-xs" data-testid="timecode">
        <span className="text-gray-900">{formatTimecode(frame, fps)}</span>
        <span className="text-gray-400"> / {formatTimecode(Math.max(0, duration), fps)}</span>
      </div>

      <div className="ml-3 flex items-center gap-1">
        {RATES.map((r) => (
          <Button
            key={r}
            size="sm"
            variant="ghost"
            active={rate === r}
            onClick={() => session.clock.setRate(r)}
          >
            {r}x
          </Button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" onClick={toggleMuted} active={muted} title="음소거">
          {muted ? '🔇' : '🔊'}
        </Button>
        <Button size="sm" onClick={applyLoop} active={loopEnabled} title="구간 반복">
          🔁
        </Button>
        <Button size="sm" onClick={() => setIn(frame)} title="In 지정 (I)">
          In {inFrame != null ? formatTimecode(inFrame, fps).slice(3) : '—'}
        </Button>
        <Button size="sm" onClick={() => setOut(frame)} title="Out 지정 (O)">
          Out {outFrame != null ? formatTimecode(outFrame, fps).slice(3) : '—'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setIn(null);
            setOut(null);
            if (loopEnabled) applyLoop();
          }}
          title="In/Out 해제"
        >
          해제
        </Button>
      </div>
    </div>
  );
}
