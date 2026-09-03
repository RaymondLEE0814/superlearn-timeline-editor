import { produce } from 'immer';
import { EngineError } from '../errors';
import { assertFrame } from '../timebase';
import type { Clip, Frame, Id, Marker, Timeline, Track } from '../types';
import { clipDuration, clipEnd, findClip, sortClips } from './model';

export type TrackFlag = 'muted' | 'solo' | 'locked';

export type Command =
  | { type: 'addClip'; clip: Clip }
  | { type: 'removeClip'; clipId: Id; ripple?: boolean }
  | { type: 'moveClip'; clipId: Id; startFrame: Frame; ripple?: boolean }
  | { type: 'trimStart'; clipId: Id; delta: Frame }
  | { type: 'trimEnd'; clipId: Id; delta: Frame }
  | { type: 'splitClip'; clipId: Id; atFrame: Frame; ids?: Record<Id, [Id, Id]> }
  | { type: 'setClipProps'; clipId: Id; props: Partial<Clip> }
  | { type: 'shiftClipIds'; clipIds: Id[]; delta: Frame }
  | { type: 'addMarker'; marker: Marker }
  | { type: 'removeMarker'; markerId: Id }
  | { type: 'moveMarker'; markerId: Id; frame: Frame }
  | { type: 'setTrackFlag'; trackId: Id; flag: TrackFlag; value: boolean }
  | { type: 'replaceTimeline'; timeline: Timeline; label?: string }
  | { type: 'batch'; commands: Command[]; label?: string };

export interface ApplyResult {
  next: Timeline;
  applied: Command;
  inverse: Command;
}

/* ──────────────────────────── 내부 헬퍼 ──────────────────────────── */

function requireClip(timeline: Timeline, clipId: Id): { track: Track; clip: Clip } {
  const found = findClip(timeline, clipId);
  if (!found) {
    throw new EngineError('OUT_OF_RANGE', `클립을 찾을 수 없습니다: ${clipId}`, { context: { clipId } });
  }
  return found;
}

function assertUnlocked(track: Track): void {
  if (track.locked) {
    throw new EngineError('TRACK_LOCKED', `잠긴 트랙입니다: ${track.name}`, {
      context: { trackId: track.id },
    });
  }
}

/** 클립과 링크 대상(V1 <-> A1)을 한 그룹으로 본다. */
function clipGroup(timeline: Timeline, clipId: Id): Clip[] {
  const { clip } = requireClip(timeline, clipId);
  const group = [clip];
  if (clip.linkedClipId) {
    const linked = findClip(timeline, clip.linkedClipId);
    if (linked) group.push(linked.clip);
  }
  return group;
}

function overlapsExisting(track: Track, start: Frame, end: Frame, ignoreIds: Set<Id>): Clip | null {
  for (const c of track.clips) {
    if (ignoreIds.has(c.id)) continue;
    if (clipEnd(c) > start && c.startFrame < end) return c;
  }
  return null;
}

function forEachClip(draft: Timeline, fn: (clip: Clip, track: Track) => void): void {
  for (const track of draft.tracks) for (const clip of track.clips) fn(clip, track);
}

function resortAll(draft: Timeline): void {
  for (const track of draft.tracks) track.clips = sortClips(track.clips);
}

/**
 * 리플 이동 대상 수집: fromFrame 이후에 시작하는 모든 클립(그룹 제외).
 * 되돌리기를 정확히 하기 위해 프레임 조건이 아니라 id 목록을 기록한다.
 */
function collectRippleIds(timeline: Timeline, fromFrame: Frame, exclude: Set<Id>): Id[] {
  const ids: Id[] = [];
  for (const track of timeline.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      if (exclude.has(clip.id)) continue;
      if (clip.startFrame >= fromFrame) ids.push(clip.id);
    }
  }
  return ids;
}

/* ──────────────────────────── 명령 적용 ──────────────────────────── */

export function applyCommand(timeline: Timeline, cmd: Command): ApplyResult {
  switch (cmd.type) {
    case 'addClip':
      return applyAddClip(timeline, cmd);
    case 'removeClip':
      return applyRemoveClip(timeline, cmd);
    case 'moveClip':
      return applyMoveClip(timeline, cmd);
    case 'trimStart':
    case 'trimEnd':
      return applyTrim(timeline, cmd);
    case 'splitClip':
      return applySplit(timeline, cmd);
    case 'setClipProps':
      return applySetClipProps(timeline, cmd);
    case 'shiftClipIds':
      return applyShift(timeline, cmd);
    case 'addMarker':
    case 'removeMarker':
    case 'moveMarker':
      return applyMarkerCmd(timeline, cmd);
    case 'setTrackFlag':
      return applySetTrackFlag(timeline, cmd);
    case 'replaceTimeline':
      return {
        next: cmd.timeline,
        applied: cmd,
        inverse: { type: 'replaceTimeline', timeline, label: cmd.label },
      };
    case 'batch': {
      let current = timeline;
      const appliedList: Command[] = [];
      const inverses: Command[] = [];
      for (const sub of cmd.commands) {
        const r = applyCommand(current, sub);
        current = r.next;
        appliedList.push(r.applied);
        inverses.push(r.inverse);
      }
      return {
        next: current,
        applied: { type: 'batch', commands: appliedList, label: cmd.label },
        inverse: { type: 'batch', commands: inverses.reverse(), label: cmd.label },
      };
    }
  }
}

function applyAddClip(timeline: Timeline, cmd: Extract<Command, { type: 'addClip' }>): ApplyResult {
  const track = timeline.tracks.find((t) => t.id === cmd.clip.trackId);
  if (!track) {
    throw new EngineError('OUT_OF_RANGE', `트랙을 찾을 수 없습니다: ${cmd.clip.trackId}`);
  }
  assertUnlocked(track);
  assertFrame(cmd.clip.startFrame, 'startFrame');
  assertFrame(cmd.clip.sourceInFrame, 'sourceInFrame');
  assertFrame(cmd.clip.sourceOutFrame, 'sourceOutFrame');
  const hit = overlapsExisting(
    track,
    cmd.clip.startFrame,
    clipEnd(cmd.clip),
    new Set([cmd.clip.id]),
  );
  if (hit) {
    throw new EngineError('CLIP_OVERLAP', `클립이 ${hit.id} 과 겹칩니다.`, {
      context: { clipId: cmd.clip.id, conflictId: hit.id },
    });
  }
  const next = produce(timeline, (d) => {
    const t = d.tracks.find((x) => x.id === cmd.clip.trackId)!;
    t.clips.push({ ...cmd.clip });
    t.clips = sortClips(t.clips);
  });
  return { next, applied: cmd, inverse: { type: 'removeClip', clipId: cmd.clip.id, ripple: false } };
}

function applyRemoveClip(
  timeline: Timeline,
  cmd: Extract<Command, { type: 'removeClip' }>,
): ApplyResult {
  const group = clipGroup(timeline, cmd.clipId);
  for (const c of group) assertUnlocked(requireClip(timeline, c.id).track);

  const primary = group[0];
  const dur = clipDuration(primary);
  const exclude = new Set(group.map((c) => c.id));
  const shiftIds = cmd.ripple ? collectRippleIds(timeline, clipEnd(primary), exclude) : [];

  const next = produce(timeline, (d) => {
    for (const track of d.tracks) track.clips = track.clips.filter((c) => !exclude.has(c.id));
    if (shiftIds.length > 0) {
      const set = new Set(shiftIds);
      forEachClip(d, (clip) => {
        if (set.has(clip.id)) clip.startFrame -= dur;
      });
      resortAll(d);
    }
  });

  const restore: Command[] = group.map((c) => ({ type: 'addClip', clip: { ...c } }));
  const inverse: Command =
    shiftIds.length > 0
      ? { type: 'batch', commands: [{ type: 'shiftClipIds', clipIds: shiftIds, delta: dur }, ...restore] }
      : restore.length === 1
        ? restore[0]
        : { type: 'batch', commands: restore };

  return { next, applied: cmd, inverse };
}

function applyMoveClip(
  timeline: Timeline,
  cmd: Extract<Command, { type: 'moveClip' }>,
): ApplyResult {
  assertFrame(cmd.startFrame, 'startFrame');
  const group = clipGroup(timeline, cmd.clipId);
  for (const c of group) assertUnlocked(requireClip(timeline, c.id).track);

  const primary = group[0];
  const delta = cmd.startFrame - primary.startFrame;
  if (delta === 0) {
    return { next: timeline, applied: cmd, inverse: { type: 'moveClip', clipId: cmd.clipId, startFrame: primary.startFrame } };
  }
  if (cmd.startFrame < 0) {
    throw new EngineError('OUT_OF_RANGE', '클립을 0프레임 앞으로 옮길 수 없습니다.');
  }

  const exclude = new Set(group.map((c) => c.id));
  let pushedIds: Id[] = [];

  if (!cmd.ripple) {
    for (const c of group) {
      const { track } = requireClip(timeline, c.id);
      const newStart = c.startFrame + delta;
      const hit = overlapsExisting(track, newStart, newStart + clipDuration(c), exclude);
      if (hit) {
        throw new EngineError('CLIP_OVERLAP', `이동 위치에서 ${hit.id} 과 겹칩니다.`, {
          context: { clipId: c.id, conflictId: hit.id },
        });
      }
    }
  } else {
    // 오른쪽으로 밀어 자리를 만든다.
    pushedIds = collectRippleIds(timeline, cmd.startFrame, exclude);
  }

  const next = produce(timeline, (d) => {
    const pushSet = new Set(pushedIds);
    const dur = clipDuration(primary);
    forEachClip(d, (clip) => {
      if (exclude.has(clip.id)) clip.startFrame += delta;
      else if (pushSet.has(clip.id)) clip.startFrame += dur;
    });
    resortAll(d);
  });

  const inverse: Command =
    pushedIds.length > 0
      ? {
          type: 'batch',
          commands: [
            { type: 'moveClip', clipId: cmd.clipId, startFrame: primary.startFrame },
            { type: 'shiftClipIds', clipIds: pushedIds, delta: -clipDuration(primary) },
          ],
        }
      : { type: 'moveClip', clipId: cmd.clipId, startFrame: primary.startFrame };

  return { next, applied: cmd, inverse };
}

function applyTrim(
  timeline: Timeline,
  cmd: Extract<Command, { type: 'trimStart' | 'trimEnd' }>,
): ApplyResult {
  assertFrame(cmd.delta, 'delta');
  const group = clipGroup(timeline, cmd.clipId);
  for (const c of group) assertUnlocked(requireClip(timeline, c.id).track);

  const primary = group[0];

  // 소스 범위 · 최소 1프레임 · 시작 0 이상 · 이웃 클립 침범 금지를 모두 만족하는 delta 로 클램프한다.
  // 그룹(링크 클립) 은 각자 트랙의 이웃이 다르므로 가장 빡빡한 제약을 쓴다.
  let minDelta = Number.NEGATIVE_INFINITY;
  let maxDelta = Number.POSITIVE_INFINITY;

  for (const c of group) {
    const { track } = requireClip(timeline, c.id);
    const sourceDuration = timeline.sources[c.sourceId]?.durationFrames ?? Number.MAX_SAFE_INTEGER;
    const sorted = sortClips(track.clips);
    const idx = sorted.findIndex((x) => x.id === c.id);
    const prev = idx > 0 ? sorted[idx - 1] : undefined;
    const nextClip = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : undefined;

    if (cmd.type === 'trimStart') {
      const leftLimit = Math.max(-c.sourceInFrame, -c.startFrame, prev ? clipEnd(prev) - c.startFrame : -Infinity);
      minDelta = Math.max(minDelta, leftLimit);
      maxDelta = Math.min(maxDelta, clipDuration(c) - 1);
    } else {
      minDelta = Math.max(minDelta, -(clipDuration(c) - 1));
      const rightLimit = Math.min(
        sourceDuration - c.sourceOutFrame,
        nextClip ? nextClip.startFrame - clipEnd(c) : Infinity,
      );
      maxDelta = Math.min(maxDelta, rightLimit);
    }
  }

  const delta = Math.min(Math.max(cmd.delta, minDelta), maxDelta);

  if (delta === 0) {
    return { next: timeline, applied: { ...cmd, delta: 0 }, inverse: { ...cmd, delta: 0 } };
  }

  const ids = new Set(group.map((c) => c.id));
  const next = produce(timeline, (d) => {
    forEachClip(d, (clip) => {
      if (!ids.has(clip.id)) return;
      if (cmd.type === 'trimStart') {
        clip.sourceInFrame += delta;
        clip.startFrame += delta;
      } else {
        clip.sourceOutFrame += delta;
      }
    });
    resortAll(d);
  });

  return {
    next,
    applied: { ...cmd, delta },
    inverse: { type: cmd.type, clipId: cmd.clipId, delta: -delta },
  };
}

function applySplit(timeline: Timeline, cmd: Extract<Command, { type: 'splitClip' }>): ApplyResult {
  assertFrame(cmd.atFrame, 'atFrame');
  const group = clipGroup(timeline, cmd.clipId);
  for (const c of group) assertUnlocked(requireClip(timeline, c.id).track);

  const primary = group[0];
  if (cmd.atFrame <= primary.startFrame || cmd.atFrame >= clipEnd(primary)) {
    throw new EngineError('OUT_OF_RANGE', '분할 지점이 클립 내부가 아닙니다.', {
      context: { clipId: cmd.clipId, atFrame: cmd.atFrame },
    });
  }

  const used = new Set<Id>();
  for (const t of timeline.tracks) for (const c of t.clips) used.add(c.id);
  const ids: Record<Id, [Id, Id]> = cmd.ids ?? {};
  for (const c of group) {
    if (ids[c.id]) continue;
    let n = 1;
    let a = `${c.id}_a`;
    let b = `${c.id}_b`;
    while (used.has(a) || used.has(b)) {
      n += 1;
      a = `${c.id}_a${n}`;
      b = `${c.id}_b${n}`;
    }
    used.add(a);
    used.add(b);
    ids[c.id] = [a, b];
  }

  const originals = group.map((c) => ({ ...c }));
  const next = produce(timeline, (d) => {
    for (const track of d.tracks) {
      const out: Clip[] = [];
      for (const clip of track.clips) {
        const pair = ids[clip.id];
        if (!pair) {
          out.push(clip);
          continue;
        }
        const offset = cmd.atFrame - clip.startFrame;
        const [aId, bId] = pair;
        const aLinked = clip.linkedClipId ? ids[clip.linkedClipId]?.[0] : undefined;
        const bLinked = clip.linkedClipId ? ids[clip.linkedClipId]?.[1] : undefined;
        out.push({
          ...clip,
          id: aId,
          sourceOutFrame: clip.sourceInFrame + offset,
          linkedClipId: aLinked,
          label: `${clip.label} (1)`,
        });
        out.push({
          ...clip,
          id: bId,
          sourceInFrame: clip.sourceInFrame + offset,
          startFrame: cmd.atFrame,
          linkedClipId: bLinked,
          label: `${clip.label} (2)`,
        });
      }
      track.clips = sortClips(out);
    }
  });

  // removeClip 은 링크 대상까지 함께 지우므로 대표 클립의 두 조각만 지운다.
  const [primaryA, primaryB] = ids[primary.id];
  const inverseCommands: Command[] = [
    { type: 'removeClip', clipId: primaryA, ripple: false },
    { type: 'removeClip', clipId: primaryB, ripple: false },
    // 링크 정보를 그대로 복원하기 위해 원본을 다시 추가한다.
    ...originals.map((c): Command => ({ type: 'addClip', clip: c })),
  ];

  return {
    next,
    applied: { ...cmd, ids },
    inverse: { type: 'batch', commands: inverseCommands },
  };
}

function applySetClipProps(
  timeline: Timeline,
  cmd: Extract<Command, { type: 'setClipProps' }>,
): ApplyResult {
  const { track, clip } = requireClip(timeline, cmd.clipId);
  assertUnlocked(track);
  const prev: Partial<Clip> = {};
  for (const key of Object.keys(cmd.props) as (keyof Clip)[]) {
    (prev as Record<string, unknown>)[key] = clip[key];
  }
  const next = produce(timeline, (d) => {
    forEachClip(d, (c) => {
      if (c.id === cmd.clipId) Object.assign(c, cmd.props);
    });
  });
  return { next, applied: cmd, inverse: { type: 'setClipProps', clipId: cmd.clipId, props: prev } };
}

function applyShift(
  timeline: Timeline,
  cmd: Extract<Command, { type: 'shiftClipIds' }>,
): ApplyResult {
  assertFrame(cmd.delta, 'delta');
  const set = new Set(cmd.clipIds);
  const next = produce(timeline, (d) => {
    forEachClip(d, (clip) => {
      if (set.has(clip.id)) clip.startFrame += cmd.delta;
    });
    resortAll(d);
  });
  return {
    next,
    applied: cmd,
    inverse: { type: 'shiftClipIds', clipIds: cmd.clipIds, delta: -cmd.delta },
  };
}

function applyMarkerCmd(
  timeline: Timeline,
  cmd: Extract<Command, { type: 'addMarker' | 'removeMarker' | 'moveMarker' }>,
): ApplyResult {
  if (cmd.type === 'addMarker') {
    assertFrame(cmd.marker.frame, 'marker.frame');
    // 같은 id 의 마커가 있으면 교체된다. 그 경우 되돌리기는 삭제가 아니라 이전 마커 복원이어야 한다.
    const replaced = timeline.markers.find((m) => m.id === cmd.marker.id);
    const next = produce(timeline, (d) => {
      d.markers = [...d.markers.filter((m) => m.id !== cmd.marker.id), cmd.marker].sort(
        (a, b) => a.frame - b.frame,
      );
    });
    return {
      next,
      applied: cmd,
      inverse: replaced
        ? { type: 'addMarker', marker: replaced }
        : { type: 'removeMarker', markerId: cmd.marker.id },
    };
  }
  if (cmd.type === 'removeMarker') {
    const prev = timeline.markers.find((m) => m.id === cmd.markerId);
    if (!prev) throw new EngineError('OUT_OF_RANGE', `마커를 찾을 수 없습니다: ${cmd.markerId}`);
    const next = produce(timeline, (d) => {
      d.markers = d.markers.filter((m) => m.id !== cmd.markerId);
    });
    return { next, applied: cmd, inverse: { type: 'addMarker', marker: prev } };
  }
  assertFrame(cmd.frame, 'frame');
  const prev = timeline.markers.find((m) => m.id === cmd.markerId);
  if (!prev) throw new EngineError('OUT_OF_RANGE', `마커를 찾을 수 없습니다: ${cmd.markerId}`);
  const next = produce(timeline, (d) => {
    const m = d.markers.find((x) => x.id === cmd.markerId)!;
    m.frame = cmd.frame;
    d.markers.sort((a, b) => a.frame - b.frame);
  });
  return {
    next,
    applied: cmd,
    inverse: { type: 'moveMarker', markerId: cmd.markerId, frame: prev.frame },
  };
}

function applySetTrackFlag(
  timeline: Timeline,
  cmd: Extract<Command, { type: 'setTrackFlag' }>,
): ApplyResult {
  const track = timeline.tracks.find((t) => t.id === cmd.trackId);
  if (!track) throw new EngineError('OUT_OF_RANGE', `트랙을 찾을 수 없습니다: ${cmd.trackId}`);
  const prev = track[cmd.flag];
  const next = produce(timeline, (d) => {
    const t = d.tracks.find((x) => x.id === cmd.trackId)!;
    t[cmd.flag] = cmd.value;
  });
  return {
    next,
    applied: cmd,
    inverse: { type: 'setTrackFlag', trackId: cmd.trackId, flag: cmd.flag, value: prev },
  };
}
