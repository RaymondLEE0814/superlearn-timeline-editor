import { frameToSec } from '../timebase';
import { clipEnd } from '../timeline/model';
import type { Fps, Frame, Timeline } from '../types';

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function stamp(frame: Frame, fps: Fps, msSeparator: '.' | ','): string {
  const total = frameToSec(frame, fps);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}${msSeparator}${pad(Math.min(999, ms), 3)}`;
}

interface Cue {
  startFrame: Frame;
  endFrame: Frame;
  text: string;
}

function collectCues(timeline: Timeline): Cue[] {
  const track = timeline.tracks.find((t) => t.kind === 'subtitle');
  if (!track) return [];
  return track.clips
    .filter((c) => c.enabled && c.subtitle && clipEnd(c) > c.startFrame)
    .map((c) => ({ startFrame: c.startFrame, endFrame: clipEnd(c), text: c.subtitle!.text }))
    .sort((a, b) => a.startFrame - b.startFrame);
}

export function toVtt(timeline: Timeline): string {
  const cues = collectCues(timeline);
  const lines = ['WEBVTT', ''];
  cues.forEach((c, i) => {
    lines.push(String(i + 1));
    lines.push(
      `${stamp(c.startFrame, timeline.fps, '.')} --> ${stamp(c.endFrame, timeline.fps, '.')}`,
    );
    lines.push(c.text);
    lines.push('');
  });
  return lines.join('\n');
}

export function toSrt(timeline: Timeline): string {
  const cues = collectCues(timeline);
  const lines: string[] = [];
  cues.forEach((c, i) => {
    lines.push(String(i + 1));
    lines.push(
      `${stamp(c.startFrame, timeline.fps, ',')} --> ${stamp(c.endFrame, timeline.fps, ',')}`,
    );
    lines.push(c.text);
    lines.push('');
  });
  return lines.join('\n');
}

export function cueCount(timeline: Timeline): number {
  return collectCues(timeline).length;
}
