import { averageEnergy, resolveWaveform } from '../metadata/waveform';
import type { AutoEditRules, MediaMetadata, ScoreParts, ScoredSegment, Segment } from '../types';

function normalize(values: number[]): number[] {
  const max = Math.max(...values, 0);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => v / max);
}

/**
 * 세그먼트별 중요도(0~1)와 근거 문자열을 만든다.
 * 각 항목을 세트 안에서 정규화한 뒤 가중합하므로 강의마다 척도가 달라도 비교 가능하다.
 */
export function scoreSegments(
  segments: Segment[],
  meta: MediaMetadata,
  rules: AutoEditRules,
): ScoredSegment[] {
  if (segments.length === 0) return [];

  const peaks = resolveWaveform(meta);
  const fps = meta.stream.fps.num / meta.stream.fps.den;

  const leafChapters = meta.chapters.filter(
    (c) => !meta.chapters.some((o) => o.parentId === c.id),
  );
  const chapterStartSet = new Map<number, string>();
  for (const c of leafChapters) chapterStartSet.set(c.startFrame, c.title);

  const rawKeyword: number[] = [];
  const rawSlide: number[] = [];
  const rawBoard: number[] = [];
  const rawEnergy: number[] = [];
  const chapterHit: Array<string | null> = [];
  const keywordHits: Array<Map<string, number>> = [];

  const tolerance = Math.round(fps); // 챕터 시작 판정 여유 1초

  for (const seg of segments) {
    const durSec = Math.max(0.001, (seg.endFrame - seg.startFrame) / fps);

    let chapterTitle: string | null = null;
    for (const [frame, title] of chapterStartSet) {
      if (Math.abs(frame - seg.startFrame) <= tolerance) {
        chapterTitle = title;
        break;
      }
    }
    chapterHit.push(chapterTitle);

    const hits = new Map<string, number>();
    let kwCount = 0;
    for (const k of meta.keywords) {
      let n = 0;
      for (const f of k.frames) if (f >= seg.startFrame && f < seg.endFrame) n += 1;
      if (n > 0) {
        hits.set(k.term, n);
        kwCount += n;
      }
    }
    keywordHits.push(hits);
    rawKeyword.push(kwCount / durSec);

    const slideCount = meta.slides.filter(
      (s) => s.frame >= seg.startFrame && s.frame < seg.endFrame,
    ).length;
    rawSlide.push(slideCount / durSec);

    let boardFrames = 0;
    let boardWeighted = 0;
    for (const b of meta.boardActivity) {
      const s = Math.max(b.startFrame, seg.startFrame);
      const e = Math.min(b.endFrame, seg.endFrame);
      if (e > s) {
        boardFrames += e - s;
        boardWeighted += (e - s) * b.intensity;
      }
    }
    rawBoard.push(boardFrames > 0 ? boardWeighted / (seg.endFrame - seg.startFrame) : 0);

    rawEnergy.push(averageEnergy(peaks, meta, seg.startFrame, seg.endFrame));
  }

  const nKeyword = normalize(rawKeyword);
  const nSlide = normalize(rawSlide);
  const nBoard = normalize(rawBoard);
  const nEnergy = normalize(rawEnergy);
  const w = rules.scoreWeights;

  return segments.map((seg, i) => {
    const parts: ScoreParts = {
      chapterStart: chapterHit[i] ? 1 : 0,
      keyword: nKeyword[i],
      energy: nEnergy[i],
      slide: nSlide[i],
      board: nBoard[i],
    };
    const score =
      parts.chapterStart * w.chapterStart +
      parts.keyword * w.keyword +
      parts.energy * w.energy +
      parts.slide * w.slide +
      parts.board * w.board;

    const reasons: string[] = [];
    if (chapterHit[i]) reasons.push(`chapter-start:${chapterHit[i]}`);
    const hits = keywordHits[i];
    if (hits.size > 0) {
      const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      reasons.push(`keywords:${top.map(([t, n]) => `${t}×${n}`).join(', ')}`);
    }
    if (parts.slide > 0.5) reasons.push('slide-transition');
    if (parts.board > 0.5) reasons.push('board-activity');
    if (parts.energy > 0.8) reasons.push('high-energy');

    const denom = w.chapterStart + w.keyword + w.energy + w.slide + w.board;
    return { ...seg, score: denom > 0 ? score / denom : 0, reasons, parts };
  });
}
