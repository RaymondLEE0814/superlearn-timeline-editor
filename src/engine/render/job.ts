import { EngineError } from '../errors';
import { Emitter } from '../events/emitter';
import { timelineDuration } from '../timeline/model';
import { validateTimeline } from '../timeline/validate';
import type {
  Frame,
  Id,
  RenderJob,
  RenderManifest,
  RenderOptions,
  RenderOutputs,
  RenderProgress,
  Timeline,
} from '../types';
import type { Ctx2D, DrawSize } from './ctx';
import { Compositor } from './compositor';
import { buildRenderGraph } from './graph';
import { toSrt, toVtt } from './subtitles';

export interface RenderEvents extends Record<string, unknown> {
  progress: RenderProgress & { jobId: Id };
  done: { jobId: Id; outputs: RenderOutputs };
  failed: { jobId: Id; error: EngineError };
  cancelled: { jobId: Id };
}

export interface RenderTarget {
  ctx: Ctx2D;
  size: DrawSize;
}

export interface RenderDeps {
  compositor: Compositor;
  /** 프레임을 그릴 대상. OffscreenCanvas 가 없으면 숨긴 canvas 를 넘긴다. */
  createTarget(width: number, height: number): RenderTarget;
  makeBlob(text: string, type: string): Blob;
  now(): number;
  schedule(cb: () => void): void;
}

export interface RenderHandle {
  jobId: Id;
  result: Promise<RenderOutputs>;
  cancel(): void;
}

const DEFAULT_FRAMES_PER_TICK = 300;

/**
 * 내보내기 잡(목업).
 * 실제 인코딩 대신 전체 프레임을 합성하며 진행률을 내고,
 * 편집 결과를 재현할 수 있는 매니페스트(EDL)와 자막 파일을 만든다.
 */
export class RenderService {
  readonly events = new Emitter<RenderEvents>();
  private jobs = new Map<Id, RenderJob>();
  private cancelled = new Set<Id>();
  private seq = 0;

  constructor(private deps: RenderDeps) {}

  listJobs(): RenderJob[] {
    return [...this.jobs.values()];
  }

  getJob(id: Id): RenderJob | undefined {
    return this.jobs.get(id);
  }

  startRender(timeline: Timeline, opts: RenderOptions): RenderHandle {
    const issues = validateTimeline(timeline);
    if (issues.length > 0) {
      throw new EngineError('INVALID_TIMELINE', `타임라인 유효성 오류 ${issues.length}건으로 내보낼 수 없습니다.`, {
        context: { issues: issues.slice(0, 5) },
      });
    }

    const jobId = `job_${++this.seq}`;
    const total = Math.max(1, timelineDuration(timeline));
    const job: RenderJob = {
      id: jobId,
      state: 'queued',
      progress: { frame: 0, total, fps: 0, etaSec: 0 },
    };
    this.jobs.set(jobId, job);

    const result = this.run(jobId, timeline, opts, total);
    return {
      jobId,
      result,
      cancel: () => {
        this.cancelled.add(jobId);
      },
    };
  }

  private run(
    jobId: Id,
    timeline: Timeline,
    opts: RenderOptions,
    total: Frame,
  ): Promise<RenderOutputs> {
    return new Promise<RenderOutputs>((resolve, reject) => {
      const job = this.jobs.get(jobId)!;
      job.state = 'running';
      const startedAt = this.deps.now();
      const step = Math.max(1, opts.framesPerTick ?? DEFAULT_FRAMES_PER_TICK);
      let frame = 0;

      // 렌더 대상 준비 실패도 잡 실패로 다뤄야 하므로 EngineError 로 감싼다.
      let target: RenderTarget;
      try {
        target = this.deps.createTarget(timeline.width, timeline.height);
      } catch (e) {
        const err = new EngineError('RENDER_FAILED', '렌더 대상을 만들지 못했습니다.', {
          context: { cause: String(e) },
        });
        job.state = 'failed';
        job.error = err.toShape();
        this.events.emit('failed', { jobId, error: err });
        reject(err);
        return;
      }

      const tick = () => {
        if (this.cancelled.has(jobId)) {
          job.state = 'cancelled';
          this.cancelled.delete(jobId);
          this.events.emit('cancelled', { jobId });
          reject(new EngineError('RENDER_ABORTED', '내보내기를 취소했습니다.', { context: { jobId } }));
          return;
        }
        try {
          const end = Math.min(total, frame + step);
          for (; frame < end; frame += 1) {
            const comp = buildRenderGraph(timeline, frame);
            this.deps.compositor.render(comp, target.ctx, target.size);
          }
          const elapsedSec = Math.max(0.001, (this.deps.now() - startedAt) / 1000);
          const progress: RenderProgress = {
            frame,
            total,
            fps: Math.round(frame / elapsedSec),
            etaSec: Math.max(0, Math.round((total - frame) / Math.max(1, frame / elapsedSec))),
          };
          job.progress = progress;
          this.events.emit('progress', { ...progress, jobId });

          if (frame < total) {
            this.deps.schedule(tick);
            return;
          }

          const outputs = this.buildOutputs(timeline, opts, total, this.deps.now() - startedAt);
          job.state = 'done';
          job.outputs = outputs;
          this.events.emit('done', { jobId, outputs });
          resolve(outputs);
        } catch (e) {
          const err =
            e instanceof EngineError
              ? e
              : new EngineError('RENDER_FAILED', '내보내기 중 오류가 발생했습니다.', {
                  context: { cause: String(e) },
                });
          job.state = 'failed';
          job.error = err.toShape();
          this.events.emit('failed', { jobId, error: err });
          reject(err);
        }
      };

      this.deps.schedule(tick);
    });
  }

  private buildOutputs(
    timeline: Timeline,
    opts: RenderOptions,
    total: Frame,
    renderMs: number,
  ): RenderOutputs {
    const outputs: RenderOutputs = {};
    if (opts.manifest) {
      const manifest: RenderManifest = {
        timeline,
        chapters: [],
        stats: {
          durationFrames: total,
          clipCount: timeline.tracks.reduce((n, t) => n + t.clips.length, 0),
          renderedAt: new Date().toISOString(),
          renderMs: Math.round(renderMs),
        },
        version: 1,
      };
      outputs.manifestJson = this.deps.makeBlob(JSON.stringify(manifest, null, 2), 'application/json');
    }
    if (opts.vtt) outputs.subtitlesVtt = this.deps.makeBlob(toVtt(timeline), 'text/vtt');
    if (opts.srt) outputs.subtitlesSrt = this.deps.makeBlob(toSrt(timeline), 'application/x-subrip');
    return outputs;
  }
}
