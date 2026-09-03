import { sourceFrameToTimelineFrame } from '../../engine/timeline/query';
import type { Frame, Timeline } from '../../engine/types';
import type { EditorSession } from '../../session/EditorSession';

/**
 * 원본(강의) 프레임으로 이동한다.
 * 자동 편집으로 잘려 나간 구간이면 그 뒤 가장 가까운 클립의 시작으로 보낸다.
 */
export function seekSourceFrame(
  session: EditorSession,
  timeline: Timeline | null,
  sourceFrame: Frame,
): void {
  if (!timeline) return;
  const direct = sourceFrameToTimelineFrame(timeline, sourceFrame);
  if (direct != null) {
    session.clock.seek(direct);
    return;
  }
  const video = timeline.tracks.find((t) => t.kind === 'video');
  if (!video) return;
  const after = video.clips.find((c) => c.sourceInFrame >= sourceFrame);
  if (after) {
    session.clock.seek(after.startFrame);
    return;
  }
  const last = video.clips[video.clips.length - 1];
  if (last) session.clock.seek(last.startFrame);
}

/** 현재 타임라인 프레임에 대응하는 원본 프레임. */
export function currentSourceFrame(timeline: Timeline | null, frame: Frame): Frame | null {
  if (!timeline) return null;
  const video = timeline.tracks.find((t) => t.kind === 'video');
  if (!video) return null;
  const clip = video.clips.find(
    (c) => frame >= c.startFrame && frame < c.startFrame + (c.sourceOutFrame - c.sourceInFrame),
  );
  return clip ? clip.sourceInFrame + (frame - clip.startFrame) : null;
}
