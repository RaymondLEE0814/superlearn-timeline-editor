import type { AnalysisRun, AnalyzeOptions, MetadataAnalyzer } from '../metadata/analyzer';
import type { RenderHandle, RenderService } from '../render/job';
import type {
  Id,
  LectureSummary,
  MediaMetadata,
  RenderJob,
  RenderOptions,
  SourceRef,
  Timeline,
} from '../types';

export interface MediaService {
  listLectures(): Promise<LectureSummary[]>;
  getLecture(lectureId: Id): Promise<LectureSummary>;
  getSource(lectureId: Id): Promise<SourceRef>;
  registerLocalFile(file: File): Promise<SourceRef>;
}

export interface AnalysisService {
  analyze(lectureId: Id, opts?: AnalyzeOptions): AnalysisRun;
  getCached(lectureId: Id): Promise<MediaMetadata | null>;
}

export interface ProjectService {
  load(lectureId: Id): Promise<Timeline | null>;
  save(lectureId: Id, timeline: Timeline): Promise<void>;
  clear(lectureId: Id): Promise<void>;
  exportJson(timeline: Timeline): Blob;
  importJson(blob: Blob): Promise<Timeline>;
}

export interface RenderServiceApi {
  startRender(timeline: Timeline, opts: RenderOptions): RenderHandle;
  listJobs(): RenderJob[];
}

export interface Services {
  media: MediaService;
  analysis: AnalysisService;
  project: ProjectService;
  render: RenderServiceApi;
}

export type { AnalysisRun, AnalyzeOptions, MetadataAnalyzer, RenderHandle, RenderService };
