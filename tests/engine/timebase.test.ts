import { describe, expect, it } from 'vitest';
import {
  FPS_2997,
  FPS_24,
  FPS_25,
  FPS_30,
  FPS_60,
  assertFrame,
  clockToFrame,
  floorToKeyframe,
  formatClock,
  formatTimecode,
  frameToSec,
  nominalFps,
  parseTimecode,
  secToFrame,
} from '../../src/engine/timebase';
import { EngineError } from '../../src/engine/errors';

const ALL = [FPS_24, FPS_25, FPS_2997, FPS_30, FPS_60];

describe('timebase', () => {
  it('프레임 <-> 초 왕복이 fps 5종에서 안정적이다', () => {
    for (const fps of ALL) {
      for (const frame of [0, 1, 25, 100, 1799, 81960, 162000]) {
        expect(secToFrame(frameToSec(frame, fps), fps, 'round')).toBe(frame);
      }
    }
  });

  it('타임코드 왕복이 정확하다', () => {
    for (const fps of ALL) {
      for (const frame of [0, 1, nominalFps(fps) - 1, nominalFps(fps), 3600 * nominalFps(fps) + 7]) {
        const tc = formatTimecode(frame, fps);
        expect(parseTimecode(tc, fps)).toBe(frame);
      }
    }
  });

  it('타임코드 포맷이 HH:MM:SS:FF 이다', () => {
    expect(formatTimecode(0, FPS_30)).toBe('00:00:00:00');
    expect(formatTimecode(29, FPS_30)).toBe('00:00:00:29');
    expect(formatTimecode(30, FPS_30)).toBe('00:00:01:00');
    // 10분 37초 12프레임
    expect(formatTimecode((10 * 60 + 37) * 30 + 12, FPS_30)).toBe('00:10:37:12');
  });

  it('formatClock 은 1시간 미만이면 MM:SS 이다', () => {
    expect(formatClock(30 * 62, FPS_30)).toBe('01:02');
    expect(formatClock(30 * 3725, FPS_30)).toBe('01:02:05');
  });

  it('29.97 은 FF 자리에 30 을 쓴다', () => {
    expect(nominalFps(FPS_2997)).toBe(30);
    expect(formatTimecode(30, FPS_2997)).toBe('00:00:01:00');
  });

  it('범위를 벗어난 타임코드는 OUT_OF_RANGE', () => {
    expect(() => parseTimecode('00:00:00:30', FPS_30)).toThrowError(EngineError);
    try {
      parseTimecode('00:60:00:00', FPS_30);
    } catch (e) {
      expect((e as EngineError).code).toBe('OUT_OF_RANGE');
    }
  });

  it('형식이 아니면 INVALID_ARGUMENT', () => {
    try {
      parseTimecode('abc', FPS_30);
    } catch (e) {
      expect((e as EngineError).code).toBe('INVALID_ARGUMENT');
    }
  });

  it('정수가 아닌 프레임은 즉시 INVALID_ARGUMENT', () => {
    expect(() => assertFrame(1.5)).toThrowError(EngineError);
    expect(() => frameToSec(1.5, FPS_30)).toThrowError(EngineError);
  });

  it('clockToFrame 이 MM:SS 와 HH:MM:SS 를 처리한다', () => {
    expect(clockToFrame('09:08', FPS_30)).toBe((9 * 60 + 8) * 30);
    expect(clockToFrame('1:00:00', FPS_30)).toBe(3600 * 30);
  });

  it('floorToKeyframe 이 이전 키프레임으로 내린다', () => {
    expect(floorToKeyframe(125, 60)).toBe(120);
    expect(floorToKeyframe(120, 60)).toBe(120);
    expect(floorToKeyframe(59, 60)).toBe(0);
    expect(floorToKeyframe(59, 1)).toBe(59);
  });

  it('secToFrame 의 반올림 모드가 다르게 동작한다', () => {
    expect(secToFrame(1.4, FPS_30, 'floor')).toBe(42);
    expect(secToFrame(1.4, FPS_30, 'ceil')).toBe(42);
    expect(secToFrame(1.41, FPS_30, 'floor')).toBe(42);
    expect(secToFrame(1.41, FPS_30, 'ceil')).toBe(43);
    expect(secToFrame(1.41, FPS_30, 'round')).toBe(42);
  });
});
