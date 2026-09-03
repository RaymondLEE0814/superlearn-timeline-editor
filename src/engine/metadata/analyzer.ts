import { EngineError } from '../errors';
import type { AnalysisProgress, AnalysisStage, Id, MediaMetadata } from '../types';

export const ANALYSIS_STAGES: AnalysisStage[] = [
  'probe',
  'audio',
  'scene',
  'transcript',
  'slides',
  'board',
  'chapters',
];

export const STAGE_LABELS: Record<AnalysisStage, string> = {
  probe: '스트림 정보 확인',
  audio: '오디오 파형 · 무음 분석',
  scene: '장면 전환 검출',
  transcript: '자막 세그먼트 정렬',
  slides: '슬라이드 전환 추출',
  board: '판서 활동 분석',
  chapters: '목차 구성',
};

export interface AnalysisRun {
  progress: AsyncIterable<AnalysisProgress>;
  result: Promise<MediaMetadata>;
  cancel(): void;
}

export interface AnalyzeOptions {
  failAt?: AnalysisStage;
  /** 단계당 지연(ms). 테스트에서는 0. */
  stageDelayMs?: number;
}

/** fixture JSON 을 읽어 오는 경로. 브라우저는 fetch, 테스트는 파일 시스템 구현을 주입한다. */
export interface FixtureLoader {
  loadMetadata(mediaId: Id): Promise<MediaMetadata>;
}

export interface MetadataAnalyzer {
  analyze(mediaId: Id, opts?: AnalyzeOptions): AnalysisRun;
  getCached(mediaId: Id): Promise<MediaMetadata | null>;
}

function delay(ms: number, signal: { cancelled: boolean }): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal.cancelled) {
      clearTimeout(t);
      resolve();
    }
  });
}

/**
 * 분석 목업. 실제 ML 대신 fixture 를 읽고 단계별 진행률만 흉내 낸다.
 * 실연동 시 이 클래스를 HttpMetadataAnalyzer 로 교체한다.
 */
export class MockMetadataAnalyzer implements MetadataAnalyzer {
  private cache = new Map<Id, MediaMetadata>();

  constructor(
    private loader: FixtureLoader,
    private defaultDelayMs = 220,
  ) {}

  getCached(mediaId: Id): Promise<MediaMetadata | null> {
    return Promise.resolve(this.cache.get(mediaId) ?? null);
  }

  analyze(mediaId: Id, opts?: AnalyzeOptions): AnalysisRun {
    const signal = { cancelled: false };
    const stageDelay = opts?.stageDelayMs ?? this.defaultDelayMs;

    let resolveResult!: (m: MediaMetadata) => void;
    let rejectResult!: (e: unknown) => void;
    const result = new Promise<MediaMetadata>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });
    // 진행률을 소비하지 않아도 unhandled rejection 이 나지 않도록 막아 둔다.
    result.catch(() => undefined);

    const self = this;
    async function* run(): AsyncGenerator<AnalysisProgress> {
      try {
        const loaded = await self.loader.loadMetadata(mediaId);
        for (let i = 0; i < ANALYSIS_STAGES.length; i += 1) {
          const stage = ANALYSIS_STAGES[i];
          if (signal.cancelled) {
            rejectResult(new EngineError('ANALYSIS_FAILED', '분석이 취소되었습니다.', { context: { mediaId } }));
            return;
          }
          // 단계마다 지연 폭을 조금씩 다르게 해 실제 파이프라인처럼 보이게 한다.
          await delay(stageDelay * (0.7 + (i % 3) * 0.35), signal);
          if (opts?.failAt === stage) {
            const err = new EngineError(
              'ANALYSIS_FAILED',
              `${STAGE_LABELS[stage]} 단계에서 분석이 실패했습니다.`,
              { context: { mediaId, stage } },
            );
            rejectResult(err);
            throw err;
          }
          yield {
            stage,
            stageIndex: i,
            stageCount: ANALYSIS_STAGES.length,
            pct: Math.round(((i + 1) / ANALYSIS_STAGES.length) * 100),
          };
        }
        self.cache.set(mediaId, loaded);
        resolveResult(loaded);
      } catch (e) {
        rejectResult(e);
        throw e;
      }
    }

    return {
      progress: run(),
      result,
      cancel() {
        signal.cancelled = true;
      },
    };
  }
}
