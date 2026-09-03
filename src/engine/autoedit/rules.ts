import { secToFrame } from '../timebase';
import type { AutoEditRules, Fps } from '../types';

export function defaultRules(fps: Fps): AutoEditRules {
  return {
    silenceThresholdDb: -40,
    minSilenceFrames: secToFrame(0.7, fps, 'round'),
    paddingFrames: secToFrame(0.15, fps, 'round'),
    minSegmentFrames: secToFrame(2, fps, 'round'),
    maxSegmentFrames: secToFrame(180, fps, 'round'),
    snapToKeyframe: false,
    boundaryWeights: { scene: 1.0, sentence: 0.8, chapter: 1.0, silence: 0.6 },
    scoreWeights: { chapterStart: 0.3, keyword: 0.25, energy: 0.2, slide: 0.15, board: 0.1 },
  };
}

export function withRules(fps: Fps, partial?: Partial<AutoEditRules>): AutoEditRules {
  const base = defaultRules(fps);
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    boundaryWeights: { ...base.boundaryWeights, ...partial.boundaryWeights },
    scoreWeights: { ...base.scoreWeights, ...partial.scoreWeights },
  };
}
