import { EngineError } from '../errors';
import type { Fps, Frame } from '../types';

export const FPS_24: Fps = { num: 24, den: 1 };
export const FPS_25: Fps = { num: 25, den: 1 };
export const FPS_2997: Fps = { num: 30000, den: 1001 };
export const FPS_30: Fps = { num: 30, den: 1 };
export const FPS_60: Fps = { num: 60, den: 1 };

export function fpsToNumber(fps: Fps): number {
  return fps.num / fps.den;
}

/** 타임코드 FF 자리에 쓰는 정수 프레임 수(29.97 -> 30). */
export function nominalFps(fps: Fps): number {
  return Math.round(fpsToNumber(fps));
}

export function assertFrame(value: number, name = 'frame'): Frame {
  if (!Number.isInteger(value)) {
    throw new EngineError('INVALID_ARGUMENT', `${name} 은 정수 프레임이어야 합니다: ${value}`, {
      context: { value, name },
    });
  }
  return value;
}

export function frameToSec(frame: Frame, fps: Fps): number {
  assertFrame(frame);
  return (frame * fps.den) / fps.num;
}

export type RoundMode = 'floor' | 'round' | 'ceil';

export function secToFrame(sec: number, fps: Fps, mode: RoundMode = 'round'): Frame {
  const exact = (sec * fps.num) / fps.den;
  switch (mode) {
    case 'floor':
      return Math.floor(exact);
    case 'ceil':
      return Math.ceil(exact);
    default:
      // 부동소수 오차로 x.9999999 가 되는 경우를 흡수한다.
      return Math.round(Number(exact.toFixed(9)));
  }
}

function pad(n: number, w = 2): string {
  return String(Math.abs(n)).padStart(w, '0');
}

/** HH:MM:SS:FF (논드롭 전용). */
export function formatTimecode(frame: Frame, fps: Fps): string {
  assertFrame(frame);
  const nf = nominalFps(fps);
  const sign = frame < 0 ? '-' : '';
  const abs = Math.abs(frame);
  const ff = abs % nf;
  const totalSec = Math.floor(abs / nf);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/** MM:SS 또는 HH:MM:SS (플레이어 표시용). */
export function formatClock(frame: Frame, fps: Fps): string {
  assertFrame(frame);
  const totalSec = Math.floor(Math.abs(frame) / nominalFps(fps));
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const sign = frame < 0 ? '-' : '';
  return hh > 0 ? `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${sign}${pad(mm)}:${pad(ss)}`;
}

export function parseTimecode(tc: string, fps: Fps): Frame {
  const m = /^(-)?(\d{1,2}):(\d{1,2}):(\d{1,2})[:;](\d{1,3})$/.exec(tc.trim());
  if (!m) {
    throw new EngineError('INVALID_ARGUMENT', `타임코드 형식이 아닙니다: ${tc}`, { context: { tc } });
  }
  const nf = nominalFps(fps);
  const [, sign, hh, mm, ss, ff] = m;
  const h = Number(hh);
  const mi = Number(mm);
  const s = Number(ss);
  const f = Number(ff);
  if (mi > 59 || s > 59 || f >= nf) {
    throw new EngineError('OUT_OF_RANGE', `타임코드 범위를 벗어났습니다: ${tc}`, {
      context: { tc, nominalFps: nf },
    });
  }
  const frames = ((h * 60 + mi) * 60 + s) * nf + f;
  return sign ? -frames : frames;
}

/** "MM:SS" 또는 "HH:MM:SS" 문자열을 프레임으로. fixture 작성 편의용. */
export function clockToFrame(clock: string, fps: Fps): Frame {
  const parts = clock.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) {
    throw new EngineError('INVALID_ARGUMENT', `시간 형식이 아닙니다: ${clock}`);
  }
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return secToFrame(sec, fps, 'round');
}

export function clampFrame(frame: Frame, min: Frame, max: Frame): Frame {
  return Math.min(Math.max(frame, min), max);
}

/** 가장 가까운 이전 키프레임. 스트리밍 친화 컷에 사용. */
export function floorToKeyframe(frame: Frame, keyframeIntervalFrames: number): Frame {
  if (keyframeIntervalFrames <= 1) return frame;
  return Math.floor(frame / keyframeIntervalFrames) * keyframeIntervalFrames;
}
