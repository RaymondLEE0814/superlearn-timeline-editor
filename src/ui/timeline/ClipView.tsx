import type { PointerEvent as ReactPointerEvent } from 'react';
import { clipDuration } from '../../engine/timeline/model';
import type { Clip, Fps, TrackKind } from '../../engine/types';
import { pxPerFrame } from './geometry';

export type DragMode = 'move' | 'trimStart' | 'trimEnd';

const TRACK_STYLE: Record<TrackKind, { bg: string; border: string; text: string }> = {
  video: { bg: 'bg-gray-700', border: 'border-gray-800', text: 'text-white' },
  overlay: { bg: 'bg-gray-300', border: 'border-gray-400', text: 'text-gray-800' },
  subtitle: { bg: 'bg-gray-200', border: 'border-gray-300', text: 'text-gray-700' },
  audio: { bg: 'bg-gray-500/25', border: 'border-gray-400', text: 'text-gray-700' },
};

export function ClipView({
  clip,
  kind,
  fps,
  zoom,
  height,
  selected,
  invalid,
  ghostDelta,
  ghostTrim,
  onPointerDown,
  onSelect,
}: {
  clip: Clip;
  kind: TrackKind;
  fps: Fps;
  zoom: number;
  height: number;
  selected: boolean;
  invalid: boolean;
  ghostDelta: number;
  ghostTrim: { start: number; end: number };
  onPointerDown: (e: ReactPointerEvent, clipId: string, mode: DragMode) => void;
  onSelect: (e: ReactPointerEvent, clipId: string) => void;
}) {
  const ppf = pxPerFrame(fps, zoom);
  const style = TRACK_STYLE[kind];
  const left = (clip.startFrame + ghostDelta + ghostTrim.start) * ppf;
  const width = Math.max(2, (clipDuration(clip) - ghostTrim.start + ghostTrim.end) * ppf);
  const showLabel = width > 42;

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`clip-${clip.id}`}
      data-clip-id={clip.id}
      aria-label={`${clip.label} 클립`}
      className={`absolute top-0.5 overflow-hidden rounded border select-none ${style.bg} ${
        invalid ? 'border-coral ring-1 ring-coral' : selected ? 'border-coral ring-2 ring-coral' : style.border
      } ${clip.enabled ? '' : 'opacity-40'}`}
      style={{ left, width, height: height - 4 }}
      onPointerDown={(e) => {
        onSelect(e, clip.id);
        onPointerDown(e, clip.id, 'move');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click();
      }}
    >
      {showLabel ? (
        <span
          className={`pointer-events-none block truncate px-1.5 pt-0.5 text-[10px] ${style.text}`}
        >
          {invalid ? '⚠ ' : ''}
          {clip.label}
        </span>
      ) : null}
      {kind === 'video' && clip.meta?.score != null && width > 90 ? (
        <span className="pointer-events-none absolute right-1 bottom-0.5 font-mono text-[9px] text-white/70">
          {(clip.meta.score * 100).toFixed(0)}
        </span>
      ) : null}

      {/* 트림 핸들 */}
      <div
        className="absolute top-0 left-0 h-full w-1.5 cursor-ew-resize bg-black/10 hover:bg-coral"
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect(e, clip.id);
          onPointerDown(e, clip.id, 'trimStart');
        }}
        data-testid={`trim-start-${clip.id}`}
      />
      <div
        className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize bg-black/10 hover:bg-coral"
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect(e, clip.id);
          onPointerDown(e, clip.id, 'trimEnd');
        }}
        data-testid={`trim-end-${clip.id}`}
      />
    </div>
  );
}
