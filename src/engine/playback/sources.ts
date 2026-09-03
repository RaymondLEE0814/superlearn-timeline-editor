import { formatTimecode } from '../timebase';
import type { Ctx2D, DrawSize } from '../render/ctx';
import type { Chapter, Fps, Frame, Id, SourceKind } from '../types';

export interface VideoSource {
  readonly id: Id;
  readonly kind: SourceKind;
  readonly durationFrames: Frame;
  prepare(): Promise<void>;
  /** 정지 상태에서 정확한 프레임을 표시할 수 있게 준비한다. */
  seekTo(sourceFrame: Frame): Promise<void>;
  /** 실제로 표시 중인 소스 프레임. 합성 소스는 항상 요청 프레임과 같다. */
  presentedFrame(): Frame;
  draw(ctx: Ctx2D, sourceFrame: Frame, size: DrawSize): void;
  dispose(): void;
}

export interface SyntheticSourceOptions {
  id: Id;
  durationFrames: Frame;
  fps: Fps;
  mediaId: string;
  chapters?: Chapter[];
}

/**
 * 합성 영상 소스.
 * 실제 mp4 없이도 프레임 정확도를 눈과 e2e 로 검증할 수 있도록
 * 화면 한가운데에 소스 프레임 번호와 타임코드를 그린다.
 */
export class SyntheticVideoSource implements VideoSource {
  readonly kind: SourceKind = 'synthetic';
  readonly id: Id;
  readonly durationFrames: Frame;
  private fps: Fps;
  private mediaId: string;
  private chapters: Chapter[];
  private current: Frame = 0;

  constructor(opts: SyntheticSourceOptions) {
    this.id = opts.id;
    this.durationFrames = opts.durationFrames;
    this.fps = opts.fps;
    this.mediaId = opts.mediaId;
    this.chapters = (opts.chapters ?? []).filter((c) => c.level === 2 || c.parentId == null);
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  seekTo(sourceFrame: Frame): Promise<void> {
    this.current = sourceFrame;
    return Promise.resolve();
  }

  presentedFrame(): Frame {
    return this.current;
  }

  private chapterAt(frame: Frame): { chapter: Chapter | undefined; index: number } {
    const idx = this.chapters.findIndex((c) => frame >= c.startFrame && frame < c.endFrame);
    return { chapter: idx >= 0 ? this.chapters[idx] : undefined, index: idx < 0 ? 0 : idx };
  }

  draw(ctx: Ctx2D, sourceFrame: Frame, size: DrawSize): void {
    this.current = sourceFrame;
    const { chapter, index } = this.chapterAt(sourceFrame);

    // 챕터마다 칠판 색조를 달리해 구간 이동이 눈에 보이게 한다.
    ctx.save();
    ctx.fillStyle = `hsl(${(140 + index * 25) % 360}, 30%, 22%)`;
    ctx.fillRect(0, 0, size.w, size.h);

    // 칠판 테두리
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(2, size.h * 0.006);
    ctx.strokeRect(size.w * 0.04, size.h * 0.08, size.w * 0.92, size.h * 0.8);

    // 중앙: 소스 프레임 번호
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(size.h * 0.18)}px system-ui, sans-serif`;
    ctx.fillText(String(sourceFrame), size.w / 2, size.h * 0.46);

    // 그 아래: 소스 타임코드
    ctx.font = `${Math.round(size.h * 0.07)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(formatTimecode(sourceFrame, this.fps), size.w / 2, size.h * 0.63);

    // 상단 좌: 챕터 제목 / 상단 우: mediaId
    ctx.font = `${Math.round(size.h * 0.038)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(chapter?.title ?? '(챕터 없음)', size.w * 0.06, size.h * 0.11);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(this.mediaId, size.w * 0.94, size.h * 0.11);

    // 하단 좌: SRC 표식
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('SRC', size.w * 0.06, size.h * 0.85);

    // 프레임마다 위치가 바뀌는 눈금. 정지 여부를 눈으로 구분하기 위한 것.
    ctx.fillStyle = '#FF3B30';
    const x = (sourceFrame % 60) / 60;
    ctx.fillRect(size.w * 0.06 + x * size.w * 0.88, size.h * 0.9, size.w * 0.012, size.h * 0.02);
    ctx.restore();
  }

  dispose(): void {
    /* 합성 소스는 정리할 자원이 없다. */
  }
}
