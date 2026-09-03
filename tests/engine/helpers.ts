import { FPS_30 } from '../../src/engine/timebase';
import { DEFAULT_SUBTITLE_STYLE, createEmptyTimeline } from '../../src/engine/timeline/model';
import { applyCommand, type Command } from '../../src/engine/timeline/commands';
import type { Clip, Timeline } from '../../src/engine/types';

export const SOURCE_DURATION = 10_000;

export function baseTimeline(): Timeline {
  return createEmptyTimeline({
    name: '테스트',
    mediaId: 'm1',
    fps: FPS_30,
    width: 1920,
    height: 1080,
    sources: {
      src1: {
        id: 'src1',
        mediaId: 'm1',
        kind: 'synthetic',
        durationFrames: SOURCE_DURATION,
        fps: FPS_30,
        label: '테스트 소스',
      },
    },
  });
}

export function videoClip(id: string, startFrame: number, inF: number, outF: number): Clip {
  return {
    id,
    trackId: 'V1',
    sourceId: 'src1',
    sourceInFrame: inF,
    sourceOutFrame: outF,
    startFrame,
    enabled: true,
    label: id,
  };
}

export function audioClip(id: string, startFrame: number, inF: number, outF: number, linked: string): Clip {
  return { ...videoClip(id, startFrame, inF, outF), trackId: 'A1', linkedClipId: linked, gain: 0 };
}

export function subtitleClip(id: string, startFrame: number, inF: number, outF: number, text: string): Clip {
  return {
    ...videoClip(id, startFrame, inF, outF),
    trackId: 'S1',
    subtitle: { text, style: DEFAULT_SUBTITLE_STYLE },
  };
}

export function overlayClip(id: string, startFrame: number, inF: number, outF: number): Clip {
  return {
    ...videoClip(id, startFrame, inF, outF),
    trackId: 'O1',
    overlay: {
      kind: 'slide',
      imageRef: 'slide://1',
      rect: { x: 0.62, y: 0.06, w: 0.32, h: 0.24 },
      opacity: 1,
    },
  };
}

export function run(timeline: Timeline, cmds: Command[]): Timeline {
  return cmds.reduce((tl, c) => applyCommand(tl, c).next, timeline);
}

/** 3개 클립이 붙어 있는 V1 + 링크된 A1 타임라인. */
export function populated(): Timeline {
  return run(baseTimeline(), [
    { type: 'addClip', clip: videoClip('v1', 0, 100, 400) },
    { type: 'addClip', clip: videoClip('v2', 300, 900, 1200) },
    { type: 'addClip', clip: videoClip('v3', 600, 2000, 2500) },
    { type: 'addClip', clip: audioClip('a1', 0, 100, 400, 'v1') },
    { type: 'setClipProps', clipId: 'v1', props: { linkedClipId: 'a1' } },
    { type: 'addClip', clip: subtitleClip('s1', 0, 100, 250, '도함수의 정의') },
    { type: 'addClip', clip: overlayClip('o1', 0, 100, 300) },
    { type: 'addMarker', marker: { id: 'mk1', frame: 300, label: '챕터 1', color: '#FF3B30', kind: 'chapter' } },
  ]);
}

/** updatedAt 등 시간 필드를 제외하고 비교하기 위한 정규화. */
export function normalize(tl: Timeline): unknown {
  return JSON.parse(JSON.stringify({ ...tl, createdAt: '', updatedAt: '' }));
}

/** 결정적 난수(mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
