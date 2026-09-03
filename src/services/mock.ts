import { EngineError } from '../engine/errors';
import { MockMetadataAnalyzer, type FixtureLoader } from '../engine/metadata/analyzer';
import type {
  LmsBridge,
  LmsEvent,
  LmsPublishInput,
} from '../engine/api/bridge';
import type { MediaService, ProjectService } from '../engine/api/services';
import { validateTimeline } from '../engine/timeline/validate';
import type { Id, LectureSummary, MediaMetadata, SourceRef, Timeline } from '../engine/types';
import { generateLecture } from '../mock/lectureGen';
import { LONG_90 } from '../mock/lectureSpecs';

export interface MockOptions {
  latencyMs?: number;
  failures?: Partial<Record<'analyze' | 'render' | 'getSource' | 'list', 'once' | 'always'>>;
}

const PROJECT_KEY = (id: Id) => `sl-editor:project:${id}`;
const LMS_LOG_KEY = 'sl-editor:lms-log';

function jitter(ms: number): Promise<void> {
  const d = ms * (0.5 + Math.random());
  return new Promise((r) => setTimeout(r, d));
}

/** fixture JSON 로더. 앱에서 유일하게 허용된 네트워크 접근(정적 자산). */
export class HttpFixtureLoader implements FixtureLoader {
  private cache = new Map<Id, MediaMetadata>();

  async loadMetadata(mediaId: Id): Promise<MediaMetadata> {
    const cached = this.cache.get(mediaId);
    if (cached) return cached;
    if (mediaId === LONG_90.mediaId) {
      const generated = generateLecture(LONG_90);
      this.cache.set(mediaId, generated);
      return generated;
    }
    const res = await fetch(`${import.meta.env.BASE_URL}fixtures/lectures/${mediaId}.meta.json`);
    if (!res.ok) {
      throw new EngineError('MEDIA_LOAD_FAILED', `강의 메타데이터를 불러오지 못했습니다: ${mediaId}`, {
        context: { mediaId, status: res.status },
      });
    }
    const meta = (await res.json()) as MediaMetadata;
    this.cache.set(mediaId, meta);
    return meta;
  }
}

export class MockMediaService implements MediaService {
  private index: LectureSummary[] | null = null;
  private localSources = new Map<Id, SourceRef>();
  private failed = new Set<string>();

  constructor(
    private loader: HttpFixtureLoader,
    private opts: MockOptions = {},
  ) {}

  private shouldFail(key: 'getSource' | 'list'): boolean {
    const mode = this.opts.failures?.[key];
    if (!mode) return false;
    if (mode === 'always') return true;
    if (this.failed.has(key)) return false;
    this.failed.add(key);
    return true;
  }

  async listLectures(): Promise<LectureSummary[]> {
    await jitter(this.opts.latencyMs ?? 180);
    if (this.shouldFail('list')) {
      throw new EngineError('MEDIA_LOAD_FAILED', '강의 목록을 불러오지 못했습니다.');
    }
    if (!this.index) {
      const res = await fetch(`${import.meta.env.BASE_URL}fixtures/index.json`);
      if (!res.ok) throw new EngineError('MEDIA_LOAD_FAILED', '강의 목록 fixture 가 없습니다.');
      const list = (await res.json()) as LectureSummary[];
      // 성능 확인용 강의는 런타임 생성이라 index.json 에 없다.
      this.index = [
        ...list,
        {
          id: LONG_90.mediaId,
          title: LONG_90.title,
          breadcrumbs: LONG_90.breadcrumbs,
          durationFrames: 90 * 60 * 60,
          fps: LONG_90.fps,
          thumbnailRef: `synthetic://${LONG_90.mediaId}`,
          analyzed: false,
        },
      ];
    }
    return this.index;
  }

  async getLecture(lectureId: Id): Promise<LectureSummary> {
    const list = await this.listLectures();
    const found = list.find((l) => l.id === lectureId);
    if (!found) {
      throw new EngineError('MEDIA_LOAD_FAILED', `강의를 찾을 수 없습니다: ${lectureId}`, {
        context: { lectureId },
      });
    }
    return found;
  }

  async getSource(lectureId: Id): Promise<SourceRef> {
    await jitter(this.opts.latencyMs ?? 180);
    if (this.shouldFail('getSource')) {
      throw new EngineError('MEDIA_LOAD_FAILED', `영상 소스를 불러오지 못했습니다: ${lectureId}`, {
        context: { lectureId },
      });
    }
    const meta = await this.loader.loadMetadata(lectureId);
    return {
      id: `src_${meta.mediaId}`,
      mediaId: meta.mediaId,
      kind: 'synthetic',
      durationFrames: meta.stream.durationFrames,
      fps: meta.stream.fps,
      label: meta.title,
    };
  }

  async registerLocalFile(file: File): Promise<SourceRef> {
    // 업로드하지 않는다. 브라우저 안에서만 쓰는 objectURL 을 만든다.
    const url = URL.createObjectURL(file);
    const id = `src_local_${this.localSources.size + 1}`;
    const ref: SourceRef = {
      id,
      mediaId: id,
      kind: 'file',
      durationFrames: 0,
      fps: { num: 30, den: 1 },
      label: file.name,
      objectUrl: url,
    };
    this.localSources.set(id, ref);
    return ref;
  }
}

export class LocalProjectService implements ProjectService {
  async load(lectureId: Id): Promise<Timeline | null> {
    try {
      const raw = localStorage.getItem(PROJECT_KEY(lectureId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { timeline: Timeline };
      if (parsed.timeline?.version !== 1) return null;
      return validateTimeline(parsed.timeline).length === 0 ? parsed.timeline : null;
    } catch {
      return null;
    }
  }

  async save(lectureId: Id, timeline: Timeline): Promise<void> {
    try {
      localStorage.setItem(
        PROJECT_KEY(lectureId),
        JSON.stringify({ timeline, savedAt: new Date().toISOString() }),
      );
    } catch (e) {
      throw new EngineError('UNKNOWN', '프로젝트 저장에 실패했습니다.', { context: { cause: String(e) } });
    }
  }

  async clear(lectureId: Id): Promise<void> {
    localStorage.removeItem(PROJECT_KEY(lectureId));
  }

  exportJson(timeline: Timeline): Blob {
    return new Blob([JSON.stringify(timeline, null, 2)], { type: 'application/json' });
  }

  async importJson(blob: Blob): Promise<Timeline> {
    const text = await blob.text();
    let parsed: Timeline;
    try {
      parsed = JSON.parse(text) as Timeline;
    } catch {
      throw new EngineError('INVALID_TIMELINE', '프로젝트 파일을 읽을 수 없습니다.');
    }
    const issues = validateTimeline(parsed);
    if (issues.length > 0) {
      throw new EngineError('INVALID_TIMELINE', `프로젝트 파일에 오류가 ${issues.length}건 있습니다.`, {
        context: { issues: issues.slice(0, 5) },
      });
    }
    return parsed;
  }
}

export class MockLmsBridge implements LmsBridge {
  async publish(input: LmsPublishInput): Promise<{ materialId: Id }> {
    const materialId = `mat_${Date.now().toString(36)}`;
    await this.reportEvent({
      verb: 'published',
      lectureId: input.lectureId,
      at: new Date().toISOString(),
      detail: { materialId, title: input.title, kind: input.kind },
    });
    return { materialId };
  }

  async reportEvent(ev: LmsEvent): Promise<void> {
    try {
      const log = this.getLog();
      log.push(ev);
      localStorage.setItem(LMS_LOG_KEY, JSON.stringify(log.slice(-100)));
    } catch {
      /* 저장 실패는 목업에서 무시한다. */
    }
  }

  getLog(): LmsEvent[] {
    try {
      const raw = localStorage.getItem(LMS_LOG_KEY);
      return raw ? (JSON.parse(raw) as LmsEvent[]) : [];
    } catch {
      return [];
    }
  }
}

export function createMockAnalysis(loader: HttpFixtureLoader, opts: MockOptions = {}) {
  return new MockMetadataAnalyzer(loader, opts.latencyMs ?? 220);
}
