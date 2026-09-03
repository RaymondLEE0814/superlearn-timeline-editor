import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLecture } from '../src/mock/lectureGen';
import { FIXTURE_SPECS } from '../src/mock/lectureSpecs';
import type { LectureSummary } from '../src/engine/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../public/fixtures/lectures');
mkdirSync(outDir, { recursive: true });

const index: LectureSummary[] = [];

for (const spec of FIXTURE_SPECS) {
  const meta = generateLecture(spec);
  const file = path.join(outDir, `${spec.mediaId}.meta.json`);
  writeFileSync(file, `${JSON.stringify(meta, null, 1)}\n`, 'utf8');
  index.push({
    id: meta.mediaId,
    title: meta.title,
    breadcrumbs: meta.breadcrumbs,
    durationFrames: meta.stream.durationFrames,
    fps: meta.stream.fps,
    thumbnailRef: `synthetic://${meta.mediaId}`,
    analyzed: false,
  });
  const sec = meta.stream.durationFrames / (meta.stream.fps.num / meta.stream.fps.den);
  console.log(
    `${meta.mediaId}: ${Math.round(sec)}s, 자막 ${meta.transcript.segments.length}, 무음 ${meta.silences.length}, 장면전환 ${meta.sceneChanges.length}, 슬라이드 ${meta.slides.length}, 판서 ${meta.boardActivity.length}, 교재 ${meta.textbookRefs.length}, 챕터 ${meta.chapters.length}`,
  );
}

writeFileSync(
  path.resolve(outDir, '../index.json'),
  `${JSON.stringify(index, null, 1)}\n`,
  'utf8',
);
console.log(`총 ${index.length}개 fixture 를 ${outDir} 에 생성했습니다.`);
