import { clockToFrame, secToFrame } from '../engine/timebase';
import type {
  Chapter,
  Fps,
  Frame,
  MediaMetadata,
  SlideEvent,
  TranscriptSegment,
} from '../engine/types';
import { mulberry32, pick, rangeInt } from './seeded';

export interface LeafSpec {
  title: string;
  /** 참조 목차에 적힌 길이. 상대 비중으로만 쓴다. */
  clock: string;
}

export interface ChapterSpec {
  title: string;
  leaves?: LeafSpec[];
  /** leaves 가 없는 장(도입부 등)의 고정 길이(초). */
  fixedSec?: number;
}

export interface LectureSpec {
  mediaId: string;
  title: string;
  breadcrumbs: string[];
  fps: Fps;
  width: number;
  height: number;
  totalClock: string;
  keyframeIntervalSec: number;
  seed: number;
  chapters: ChapterSpec[];
  keywords: string[];
}

const SENTENCE_TEMPLATES: readonly string[] = [
  '{topic}에서 가장 먼저 확인할 것은 {kw}의 정의입니다.',
  '{kw}는 함수의 변화율을 나타내는 값으로 이해할 수 있습니다.',
  '이제 {topic}을 실제 문제에 적용해 보겠습니다.',
  '여기서 {kw}의 조건을 만족하는지 반드시 확인해야 합니다.',
  '그림에서 보듯이 {kw}는 접선의 기울기와 같습니다.',
  '{topic}의 핵심은 극한이 존재하는지 판단하는 데 있습니다.',
  '앞에서 배운 {kw}를 그대로 사용하면 계산이 간단해집니다.',
  '이 식을 정리하면 {kw}에 대한 표준형이 나옵니다.',
  '학생들이 자주 실수하는 부분이 바로 {topic}입니다.',
  '{kw}를 적용하기 전에 정의역을 먼저 확인합니다.',
  '양변을 미분하면 {kw}의 형태가 그대로 드러납니다.',
  '{topic}은 시험에서 매우 자주 출제되는 내용입니다.',
  '이 경우 {kw}의 부호가 바뀌는 지점을 찾아야 합니다.',
  '칠판에 정리한 것처럼 {kw}는 두 단계로 계산합니다.',
  '조금 더 일반적인 상황으로 {topic}을 확장해 보겠습니다.',
  '{kw}의 기하학적 의미를 그래프로 확인해 봅시다.',
  '여기까지가 {topic}의 기본 내용입니다.',
  '다음 예제에서 {kw}를 직접 계산해 보겠습니다.',
  '이 결과는 {kw}의 정의로부터 바로 따라옵니다.',
  '{topic}을 이해하면 이후 단원이 훨씬 쉬워집니다.',
  '분모가 0이 되지 않도록 {kw}의 조건을 확인합니다.',
  '표를 그려서 {kw}의 증감을 정리해 보겠습니다.',
  '{topic}에서는 계산보다 개념 이해가 먼저입니다.',
  '이제 {kw}를 이용해 최종 답을 구하겠습니다.',
  '앞의 결과와 비교하면 {topic}의 구조가 보입니다.',
  '{kw}가 연속인지 먼저 살펴보아야 합니다.',
  '이 문제는 {topic}의 전형적인 유형입니다.',
  '식을 다시 쓰면 {kw}의 성질을 활용할 수 있습니다.',
  '{topic}을 정리하면서 이번 시간을 마치겠습니다.',
  '질문이 많았던 {kw} 부분을 한 번 더 설명하겠습니다.',
] as const;

interface LeafPlan {
  chapterId: string;
  title: string;
  startFrame: Frame;
  endFrame: Frame;
  index: number;
}

function buildChapters(spec: LectureSpec): { chapters: Chapter[]; leaves: LeafPlan[] } {
  const totalFrames = clockToFrame(spec.totalClock, spec.fps);
  const fixedSec = spec.chapters.reduce((s, c) => s + (c.leaves ? 0 : (c.fixedSec ?? 0)), 0);
  const weightSec = spec.chapters
    .flatMap((c) => c.leaves ?? [])
    .reduce((s, l) => s + clockToFrame(l.clock, spec.fps), 0);

  const fixedFrames = secToFrame(fixedSec, spec.fps, 'round');
  const scalable = totalFrames - fixedFrames;
  // 참조 목차의 길이 합(74:06)이 표시 길이(45:32)와 맞지 않아 비중으로만 사용한다.
  const scale = weightSec > 0 ? scalable / weightSec : 0;

  const chapters: Chapter[] = [];
  const leaves: LeafPlan[] = [];
  let cursor = 0;
  let leafIndex = 0;

  spec.chapters.forEach((c, ci) => {
    const parentId = `ch${ci}`;
    const parentStart = cursor;

    if (!c.leaves || c.leaves.length === 0) {
      const len = secToFrame(c.fixedSec ?? 0, spec.fps, 'round');
      cursor += len;
      chapters.push({
        id: parentId,
        title: c.title,
        startFrame: parentStart,
        endFrame: cursor,
        level: 1,
      });
      leaves.push({
        chapterId: parentId,
        title: c.title,
        startFrame: parentStart,
        endFrame: cursor,
        index: leafIndex++,
      });
      return;
    }

    const childChapters: Chapter[] = [];
    c.leaves.forEach((leaf, li) => {
      const raw = clockToFrame(leaf.clock, spec.fps) * scale;
      const len = Math.max(1, Math.round(raw));
      const id = `ch${ci}_${li}`;
      const start = cursor;
      cursor += len;
      childChapters.push({
        id,
        title: leaf.title,
        startFrame: start,
        endFrame: cursor,
        level: 2,
        parentId,
      });
      leaves.push({
        chapterId: id,
        title: leaf.title,
        startFrame: start,
        endFrame: cursor,
        index: leafIndex++,
      });
    });

    chapters.push({
      id: parentId,
      title: c.title,
      startFrame: parentStart,
      endFrame: cursor,
      level: 1,
    });
    chapters.push(...childChapters);
  });

  // 반올림 잔여를 마지막 항목이 흡수해 챕터가 전체 길이를 정확히 채우게 한다.
  const drift = totalFrames - cursor;
  if (drift !== 0 && leaves.length > 0) {
    const last = leaves[leaves.length - 1];
    last.endFrame += drift;
    const lastChapter = chapters.find((c) => c.id === last.chapterId);
    if (lastChapter) lastChapter.endFrame += drift;
    const parent = chapters.find(
      (c) => c.level === 1 && c.endFrame === cursor && c.id !== last.chapterId,
    );
    if (parent) parent.endFrame += drift;
  }

  chapters.sort((a, b) => a.startFrame - b.startFrame || a.level - b.level);
  return { chapters, leaves };
}

export function generateLecture(spec: LectureSpec): MediaMetadata {
  const rng = mulberry32(spec.seed);
  const fpsNum = spec.fps.num / spec.fps.den;
  const { chapters, leaves } = buildChapters(spec);
  const totalFrames = clockToFrame(spec.totalClock, spec.fps);

  const transcript: TranscriptSegment[] = [];
  const silences: MediaMetadata['silences'] = [];
  const boardActivity: MediaMetadata['boardActivity'] = [];
  const textbookRefs: MediaMetadata['textbookRefs'] = [];
  const slides: SlideEvent[] = [];
  const sceneChanges: Array<{ frame: Frame; score: number }> = [];
  const keywordFrames = new Map<string, Frame[]>();
  for (const k of spec.keywords) keywordFrames.set(k, []);

  let segId = 0;
  let slideId = 0;

  for (const leaf of leaves) {
    // 장 시작은 항상 강한 장면 전환이자 슬라이드 전환이다.
    sceneChanges.push({ frame: leaf.startFrame, score: 0.85 + rng() * 0.15 });
    slides.push({
      frame: leaf.startFrame,
      slideId: `sl${String(slideId).padStart(2, '0')}`,
      imageRef: `slide://${spec.mediaId}/${slideId}`,
      title: leaf.title,
    });
    slideId += 1;

    let cursor = leaf.startFrame;
    // 장 시작 직후 짧은 무음(전환 여백)
    const lead = secToFrame(0.4 + rng() * 0.8, spec.fps, 'round');
    if (cursor + lead < leaf.endFrame) {
      silences.push({ startFrame: cursor, endFrame: cursor + lead, levelDb: -52 - rng() * 8 });
      cursor += lead;
    }

    while (cursor < leaf.endFrame - fpsNum) {
      const speechFrames = secToFrame(2.5 + rng() * 4.5, spec.fps, 'round');
      const end = Math.min(cursor + speechFrames, leaf.endFrame);
      const kw = pick(rng, spec.keywords);
      const text = pick(rng, SENTENCE_TEMPLATES)
        .replace('{topic}', leaf.title.replace(/^\d+[-.]?\d*\.?\s*/, ''))
        .replace('{kw}', kw);

      // 긴 문장은 두 조각으로 나눠 문장 경계(isSentenceEnd) 신호를 만든다.
      const splitLong = speechFrames > secToFrame(5.5, spec.fps, 'round') && rng() > 0.55;
      if (splitLong) {
        const mid = cursor + Math.floor((end - cursor) / 2);
        const comma = text.indexOf(' ', Math.floor(text.length / 2));
        const head = comma > 0 ? `${text.slice(0, comma)},` : text;
        const tail = comma > 0 ? text.slice(comma + 1) : text;
        transcript.push({
          id: `seg${String(segId++).padStart(4, '0')}`,
          startFrame: cursor,
          endFrame: mid,
          text: head,
          isSentenceEnd: false,
          chapterId: leaf.chapterId,
        });
        transcript.push({
          id: `seg${String(segId++).padStart(4, '0')}`,
          startFrame: mid,
          endFrame: end,
          text: tail,
          isSentenceEnd: true,
          chapterId: leaf.chapterId,
        });
      } else {
        transcript.push({
          id: `seg${String(segId++).padStart(4, '0')}`,
          startFrame: cursor,
          endFrame: end,
          text,
          isSentenceEnd: true,
          chapterId: leaf.chapterId,
        });
      }

      const found = keywordFrames.get(kw);
      if (found) found.push(cursor);

      // 판서는 문장 구간의 일부에서 일어난다.
      if (rng() > 0.62) {
        const bStart = cursor + Math.floor((end - cursor) * 0.2);
        boardActivity.push({
          startFrame: bStart,
          endFrame: Math.min(end, bStart + secToFrame(1 + rng() * 2.5, spec.fps, 'round')),
          intensity: 0.3 + rng() * 0.7,
        });
      }
      if (rng() > 0.88) {
        textbookRefs.push({
          startFrame: cursor,
          endFrame: end,
          page: rangeInt(rng, 24, 96),
          ref: `정리 ${rangeInt(rng, 1, 5)}.${rangeInt(rng, 1, 9)}.${rangeInt(rng, 1, 4)}`,
        });
      }

      cursor = end;
      const gap = secToFrame(0.3 + rng() * 2.2, spec.fps, 'round');
      const gapEnd = Math.min(cursor + gap, leaf.endFrame);
      if (gapEnd > cursor) {
        silences.push({ startFrame: cursor, endFrame: gapEnd, levelDb: -46 - rng() * 14 });
        cursor = gapEnd;
      }

      // 장 중간 슬라이드 전환
      if (rng() > 0.93 && cursor < leaf.endFrame - fpsNum) {
        slides.push({
          frame: cursor,
          slideId: `sl${String(slideId).padStart(2, '0')}`,
          imageRef: `slide://${spec.mediaId}/${slideId}`,
          title: `${leaf.title} (${slideId})`,
        });
        slideId += 1;
        sceneChanges.push({ frame: cursor, score: 0.6 + rng() * 0.3 });
      } else if (rng() > 0.9) {
        sceneChanges.push({ frame: cursor, score: 0.25 + rng() * 0.3 });
      }
    }

    // 장 끝 여백
    if (cursor < leaf.endFrame) {
      silences.push({ startFrame: cursor, endFrame: leaf.endFrame, levelDb: -55 - rng() * 5 });
    }
  }

  sceneChanges.sort((a, b) => a.frame - b.frame);
  silences.sort((a, b) => a.startFrame - b.startFrame);

  return {
    mediaId: spec.mediaId,
    title: spec.title,
    breadcrumbs: spec.breadcrumbs,
    stream: {
      durationFrames: totalFrames,
      fps: spec.fps,
      width: spec.width,
      height: spec.height,
      keyframeIntervalFrames: secToFrame(spec.keyframeIntervalSec, spec.fps, 'round'),
      codec: 'avc1.640028',
      container: 'mp4',
      sourceKind: 'synthetic',
    },
    waveform: { samplesPerSecond: 20, seed: spec.seed },
    silences,
    sceneChanges,
    transcript: { language: 'ko', segments: transcript },
    slides,
    boardActivity,
    textbookRefs,
    chapters,
    keywords: spec.keywords.map((term) => ({ term, frames: keywordFrames.get(term) ?? [] })),
  };
}
