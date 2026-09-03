import type { LmsBridge } from '../engine/api/bridge';
import type { AnalysisService, MediaService, ProjectService } from '../engine/api/services';
import {
  HttpFixtureLoader,
  LocalProjectService,
  MockLmsBridge,
  MockMediaService,
  createMockAnalysis,
  type MockOptions,
} from './mock';

export interface AppServices {
  media: MediaService;
  analysis: AnalysisService;
  project: ProjectService;
  lms: LmsBridge;
  loader: HttpFixtureLoader;
}

export interface CreateServicesInput extends MockOptions {
  mode?: 'mock';
}

/**
 * 서비스 조립 지점.
 * 실연동 시 여기서 Http* 구현체를 주입하면 UI 와 엔진은 바뀌지 않는다.
 */
export function createServices(input: CreateServicesInput = {}): AppServices {
  const loader = new HttpFixtureLoader();
  return {
    loader,
    media: new MockMediaService(loader, input),
    analysis: createMockAnalysis(loader, input),
    project: new LocalProjectService(),
    lms: new MockLmsBridge(),
  };
}

/** URL 쿼리에서 목업 지연 · 실패 주입을 읽는다. `?debug=1&fail=getSource` */
export function servicesFromQuery(search: string): CreateServicesInput {
  const q = new URLSearchParams(search);
  const failures: MockOptions['failures'] = {};
  const fail = q.get('fail');
  if (fail === 'getSource') failures.getSource = 'once';
  if (fail === 'list') failures.list = 'once';
  if (fail === 'analyze') failures.analyze = 'once';
  const latency = q.get('latency');
  return {
    latencyMs: latency ? Number(latency) : undefined,
    failures: Object.keys(failures).length > 0 ? failures : undefined,
  };
}

export function isDebug(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

export * from './mock';
