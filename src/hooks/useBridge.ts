import { useEffect } from 'react';
import { PlayerBridge } from '../engine/api/bridge';
import { errorBus } from '../engine/errors';
import { toVtt } from '../engine/render/subtitles';
import { frameToSec, secToFrame } from '../engine/timebase';
import { timelineDuration } from '../engine/timeline/model';
import type { RenderManifest } from '../engine/types';
import type { EditorSession } from '../session/EditorSession';
import { useEditorStore } from '../store/editorStore';
import { useUiStore } from '../store/uiStore';

const FRAME_THROTTLE_MS = 100;

/**
 * 자사 플레이어와의 postMessage 연결.
 * 편집기가 iframe 안에서 뜬 경우에만 부모 창에 붙는다.
 */
export function useBridge(session: EditorSession | null): void {
  useEffect(() => {
    if (!session) return;
    if (window.parent === window) return;

    const bridge = new PlayerBridge((e) => errorBus.report(e));
    bridge.connect(window.parent, window, '*');

    const offOpen = bridge.events.on('open', (p) => {
      const { lectureId, initialFrame } = p as { lectureId: string; initialFrame?: number };
      const current = useEditorStore.getState().lectureId;
      if (lectureId && lectureId !== current) {
        window.location.pathname = `${import.meta.env.BASE_URL}editor/${encodeURIComponent(lectureId)}`;
        return;
      }
      if (initialFrame != null) session.clock.seek(initialFrame);
    });

    const offSeek = bridge.events.on('seek', (p) => {
      const { frame, sec } = p as { frame?: number; sec?: number };
      const fps = session.meta.stream.fps;
      if (frame != null) session.clock.seek(Math.round(frame));
      else if (sec != null) session.clock.seek(secToFrame(sec, fps, 'round'));
    });

    const offSelect = bridge.events.on('select-transcript', (p) => {
      const { segmentIds } = p as { segmentIds: string[] };
      useEditorStore.getState().setTranscriptSelection(segmentIds ?? []);
      useUiStore.getState().setPanel('transcript');
    });

    const offExport = bridge.events.on('request-export', () => {
      const timeline = useEditorStore.getState().timeline;
      if (!timeline) return;
      try {
        const handle = session.render.startRender(timeline, {
          manifest: true,
          vtt: true,
          srt: false,
          captureWebm: false,
          framesPerTick: 900,
        });
        const offProgress = session.render.events.on('progress', (pr) => {
          if (pr.jobId === handle.jobId) {
            bridge.send('export:progress', { frame: pr.frame, total: pr.total });
          }
        });
        handle.result
          .then(async (out) => {
            const manifest = out.manifestJson
              ? ((JSON.parse(await out.manifestJson.text()) as RenderManifest) ?? null)
              : null;
            bridge.send('export:done', { manifest, vtt: toVtt(timeline) });
          })
          .catch((e) => {
            bridge.send('export:error', errorBus.report(e));
          })
          .finally(offProgress);
      } catch (e) {
        bridge.send('export:error', errorBus.report(e));
      }
    });

    // 현재 위치를 10Hz 로 알린다.
    let lastSent = 0;
    const offFrame = session.clock.events.on('frame', ({ frame }) => {
      const now = performance.now();
      if (now - lastSent < FRAME_THROTTLE_MS) return;
      lastSent = now;
      bridge.send('frame', { frame, sec: frameToSec(frame, session.meta.stream.fps) });
    });

    const unsubTimeline = useEditorStore.subscribe((state, prev) => {
      if (state.timeline === prev.timeline || !state.timeline) return;
      bridge.send('timeline-changed', {
        durationFrames: timelineDuration(state.timeline),
        clipCount: state.timeline.tracks.reduce((n, t) => n + t.clips.length, 0),
      });
    });

    const offErrors = errorBus.subscribe((shape) => {
      if (shape.severity === 'error' || shape.severity === 'fatal') bridge.send('error', shape);
    });

    bridge.send('ready', { version: 1 });

    return () => {
      offOpen();
      offSeek();
      offSelect();
      offExport();
      offFrame();
      unsubTimeline();
      offErrors();
      bridge.disconnect();
    };
  }, [session]);
}
