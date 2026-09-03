import type { EngineErrorCode, EngineErrorShape, Severity } from '../types';

const DEFAULT_SEVERITY: Record<EngineErrorCode, Severity> = {
  MEDIA_LOAD_FAILED: 'error',
  DECODE_ERROR: 'error',
  SEEK_TIMEOUT: 'warn',
  ANALYSIS_FAILED: 'error',
  INVALID_TIMELINE: 'error',
  CLIP_OVERLAP: 'warn',
  OUT_OF_RANGE: 'warn',
  TRACK_LOCKED: 'info',
  INVALID_ARGUMENT: 'error',
  RENDER_ABORTED: 'info',
  RENDER_FAILED: 'error',
  AUDIO_CONTEXT_BLOCKED: 'warn',
  BRIDGE_PROTOCOL_ERROR: 'warn',
  UNKNOWN: 'fatal',
};

/** 복구 정책: recoverable = true 면 UI 가 재시도 버튼을 제공한다. */
const DEFAULT_RECOVERABLE: Record<EngineErrorCode, boolean> = {
  MEDIA_LOAD_FAILED: true,
  DECODE_ERROR: true,
  SEEK_TIMEOUT: true,
  ANALYSIS_FAILED: true,
  INVALID_TIMELINE: false,
  CLIP_OVERLAP: false,
  OUT_OF_RANGE: false,
  TRACK_LOCKED: false,
  INVALID_ARGUMENT: false,
  RENDER_ABORTED: false,
  RENDER_FAILED: true,
  AUDIO_CONTEXT_BLOCKED: true,
  BRIDGE_PROTOCOL_ERROR: false,
  UNKNOWN: false,
};

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly severity: Severity;
  readonly recoverable: boolean;
  readonly context?: Record<string, unknown>;
  readonly at: string;

  constructor(
    code: EngineErrorCode,
    message: string,
    opts?: { context?: Record<string, unknown>; severity?: Severity; recoverable?: boolean },
  ) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.severity = opts?.severity ?? DEFAULT_SEVERITY[code];
    this.recoverable = opts?.recoverable ?? DEFAULT_RECOVERABLE[code];
    this.context = opts?.context;
    this.at = new Date().toISOString();
  }

  toShape(): EngineErrorShape {
    return {
      code: this.code,
      message: this.message,
      severity: this.severity,
      recoverable: this.recoverable,
      context: this.context,
      at: this.at,
    };
  }
}

/** 엔진 밖에서 흘러들어온 예외를 EngineError 로 정규화한다. */
export function toEngineError(e: unknown): EngineError {
  if (e instanceof EngineError) return e;
  if (e instanceof Error) return new EngineError('UNKNOWN', e.message, { context: { name: e.name } });
  return new EngineError('UNKNOWN', String(e));
}

export type ErrorListener = (shape: EngineErrorShape) => void;

/** 엔진 전역 오류 버스. UI 의 문제 로그 패널 · 토스트가 구독한다. */
export class ErrorBus {
  private listeners = new Set<ErrorListener>();
  private log: EngineErrorShape[] = [];
  private maxLog = 200;

  subscribe(fn: ErrorListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  report(e: unknown): EngineErrorShape {
    const shape = toEngineError(e).toShape();
    this.log.push(shape);
    if (this.log.length > this.maxLog) this.log.shift();
    for (const fn of this.listeners) fn(shape);
    return shape;
  }

  getLog(): readonly EngineErrorShape[] {
    return this.log;
  }

  clear(): void {
    this.log = [];
  }
}

export const errorBus = new ErrorBus();
