# 진행 상황

문서: `../docs/07_IMPLEMENTATION_PLAN.md` · 구현 스킬: `superlearn-editor-impl`

## Phase 0 — 스캐폴드 ✅

- [x] Vite 6 + React 19 + TS strict + Tailwind 4 + Zustand/immer + Vitest + Playwright
- [x] 폴더 구조, `public/_redirects`, `.gitignore`
- [x] `npm install` 성공 (Node 24.13, npm 11.6)

## Phase 1 — timebase + timeline 모델 ✅

- [x] `engine/timebase`: Fps, sec↔frame, 타임코드 3종, 키프레임 내림
- [x] `engine/errors`: EngineError 14코드, 심각도 · 복구 정책 기본값, ErrorBus
- [x] `engine/events`: 타입드 Emitter
- [x] `engine/timeline`: 모델, 명령 14종, inverse, History(coalesce), validate, query
- [x] 테스트 36개 통과

Phase 1에서 테스트가 찾아낸 실제 버그 4건을 수정했다.

| 버그 | 증상 | 수정 |
|---|---|---|
| 트림 이웃 침범 | `trimEnd` 가 다음 클립을 덮어써 CLIP_OVERLAP 상태를 만듦 | 이웃 클립 경계까지 delta 클램프 |
| 병합 되돌리기 | 같은 coalesceKey 로 합친 상대값 트림이 1회분만 복구됨 | 병합 시 inverse 를 역순 batch 로 누적 |
| 마커 덮어쓰기 | 같은 id 마커 추가 시 inverse 가 삭제라 원본이 사라짐 | 교체된 마커를 inverse 로 복원 |
| split 되돌리기 | 링크 클립을 두 번 삭제해 OUT_OF_RANGE | 대표 클립 조각만 삭제(링크는 연쇄 삭제됨) |

## Phase 2 — 메타데이터 목업 + 자동 편집 엔진 ✅

- [x] `scripts/gen-fixtures.ts` (시드 결정적), fixture 2종 + `index.json`
- [x] `engine/metadata`: 파형 결정적 생성, `MockMetadataAnalyzer`(7단계 · 지연 · failAt · cancel)
- [x] `engine/autoedit`: 경계 식별 → 발화 구간 → 세그먼트화 → 스코어링 → 프리셋 선택 → 트랙 배치
- [x] 테스트 27개 통과 (누적 63개)

fixture 규모

| fixture | 길이 | fps | 자막 | 무음 | 장면전환 | 슬라이드 | 판서 | 교재 | 챕터 |
|---|---|---|---|---|---|---|---|---|---|
| calc-30-derivatives | 45:32 | 30 | 510 | 456 | 78 | 41 | 173 | 56 | 21 |
| short-demo | 03:00 | 25 | 35 | 33 | 7 | 6 | 12 | 6 | 6 |

성능: 90분 60fps 강의 자동 편집이 500ms 미만.

Phase 2에서 고친 것: 키프레임 스냅이 연속 세그먼트 경계까지 당겨 겹침을 만들던 문제. 실제 컷 지점에만 적용하도록 변경.

## Phase 3 — 재생 · 동기화 · 스트리밍 · 프리뷰 ⏳

## Phase 4 — 타임라인 UI · 패널 ⏳

## Phase 5 — 렌더 · 내보내기 · 오류 복구 ⏳

## Phase 6 — 브리지 · 배포 ⏳
