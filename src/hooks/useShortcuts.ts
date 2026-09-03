import { useEffect } from 'react';
import { clipEnd } from '../engine/timeline/model';
import { nextEdgeFrame } from '../engine/timeline/query';
import type { EditorSession } from '../session/EditorSession';
import { useEditorStore } from '../store/editorStore';
import { usePlaybackStore } from '../store/playbackStore';
import { useUiStore } from '../store/uiStore';

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** docs/05_UI_WIREFRAME.md 의 단축키 표를 그대로 구현한다. */
export function useShortcuts(session: EditorSession | null): void {
  useEffect(() => {
    if (!session) return;
    const active = session;

    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const editor = useEditorStore.getState();
      const playback = usePlaybackStore.getState();
      const ui = useUiStore.getState();
      const timeline = editor.timeline;
      const frame = playback.frame;
      const mod = e.ctrlKey || e.metaKey;

      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      // Undo / Redo
      if (mod && e.key.toLowerCase() === 'z') {
        stop();
        if (e.shiftKey) editor.redoAction();
        else editor.undoAction();
        return;
      }
      if (mod && e.key.toLowerCase() === 'k') {
        stop();
        splitAtPlayhead();
        return;
      }
      if (mod) return;

      switch (e.key) {
        case ' ':
          stop();
          void active.mixer.ensureStarted();
          active.clock.toggle();
          return;
        case 'k':
        case 'K':
          stop();
          active.clock.pause();
          return;
        case 'j':
        case 'J':
          stop();
          active.clock.setRate(playback.rate === 2 ? 1 : 2);
          active.clock.step(-10);
          return;
        case 'l':
        case 'L':
          stop();
          active.clock.setRate(playback.rate === 2 ? 1 : 2);
          if (!playback.isPlaying) active.clock.play();
          return;
        case 'ArrowLeft':
          stop();
          active.clock.step(e.shiftKey ? -10 : -1);
          return;
        case 'ArrowRight':
          stop();
          active.clock.step(e.shiftKey ? 10 : 1);
          return;
        case 'ArrowUp':
          stop();
          if (timeline) active.clock.seek(nextEdgeFrame(timeline, frame, -1));
          return;
        case 'ArrowDown':
          stop();
          if (timeline) active.clock.seek(nextEdgeFrame(timeline, frame, 1));
          return;
        case 'Home':
          stop();
          active.clock.seek(0);
          return;
        case 'End':
          stop();
          active.clock.seek(Math.max(0, playback.duration - 1));
          return;
        case 'PageDown':
          stop();
          jumpChapter(1);
          return;
        case 'PageUp':
          stop();
          jumpChapter(-1);
          return;
        case 's':
        case 'S':
          stop();
          splitAtPlayhead();
          return;
        case 'Delete':
        case 'Backspace':
          stop();
          for (const id of editor.selectedClipIds) {
            editor.dispatch({ type: 'removeClip', clipId: id, ripple: e.shiftKey });
          }
          editor.selectClips([]);
          return;
        case 'i':
        case 'I':
          stop();
          if (e.altKey) playback.setIn(null);
          else playback.setIn(frame);
          return;
        case 'o':
        case 'O':
          stop();
          if (e.altKey) playback.setOut(null);
          else playback.setOut(frame);
          return;
        case 'm':
        case 'M':
          stop();
          if (e.shiftKey) {
            const hit = timeline?.markers.find((mk) => Math.abs(mk.frame - frame) <= 2);
            if (hit) editor.dispatch({ type: 'removeMarker', markerId: hit.id });
          } else {
            editor.dispatch({
              type: 'addMarker',
              marker: {
                id: `mk_user_${frame}`,
                frame,
                label: `마커 ${frame}`,
                color: '#0A84FF',
                kind: 'user',
              },
            });
          }
          return;
        case '[':
          stop();
          trimToPlayhead('start');
          return;
        case ']':
          stop();
          trimToPlayhead('end');
          return;
        case '+':
        case '=':
          stop();
          ui.setZoom(ui.zoom * 1.6);
          return;
        case '-':
        case '_':
          stop();
          ui.setZoom(ui.zoom / 1.6);
          return;
        case 'z':
        case 'Z':
          if (e.shiftKey) {
            stop();
            const dur = playback.duration;
            if (dur > 0) ui.setZoom((window.innerWidth - 220) / ((dur / 30) * 20));
          }
          return;
        case 'Tab': {
          stop();
          const video = timeline?.tracks.find((t) => t.kind === 'video');
          if (!video || video.clips.length === 0) return;
          const cur = editor.selectedClipIds[0];
          const idx = video.clips.findIndex((c) => c.id === cur);
          const next = video.clips[(idx + 1) % video.clips.length];
          editor.selectClips([next.id]);
          active.clock.seek(next.startFrame);
          return;
        }
        default:
          return;
      }

      function splitAtPlayhead() {
        const tl = useEditorStore.getState().timeline;
        if (!tl) return;
        const video = tl.tracks.find((t) => t.kind === 'video');
        const target = video?.clips.find((c) => frame > c.startFrame && frame < clipEnd(c));
        if (target) useEditorStore.getState().dispatch({ type: 'splitClip', clipId: target.id, atFrame: frame });
        else useUiStore.getState().notify('플레이헤드가 클립 안에 있어야 분할할 수 있습니다.');
      }

      function trimToPlayhead(which: 'start' | 'end') {
        const st = useEditorStore.getState();
        const id = st.selectedClipIds[0];
        if (!id || !st.timeline) return;
        const found = st.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
        if (!found) return;
        if (which === 'start') {
          st.dispatch({ type: 'trimStart', clipId: id, delta: frame - found.startFrame });
        } else {
          st.dispatch({ type: 'trimEnd', clipId: id, delta: frame - clipEnd(found) });
        }
      }

      function jumpChapter(dir: 1 | -1) {
        const tl = useEditorStore.getState().timeline;
        if (!tl) return;
        const frames = tl.markers.filter((m) => m.kind === 'chapter').map((m) => m.frame).sort((a, b) => a - b);
        if (frames.length === 0) return;
        const target =
          dir === 1 ? frames.find((f) => f > frame) : [...frames].reverse().find((f) => f < frame);
        if (target != null) active.clock.seek(target);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);
}
