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

## Phase 3 — 재생 · 동기화 · 스트리밍 · 프리뷰 ✅

- [x] `MasterClock`: 정수 앵커 + 벽시계 경과로 프레임 재계산(누적 오차 없음), 배속 · 루프 · 스텝 · ended
- [x] `SyncEngine.resolve`: 트랙별 표시 대상, 뮤트 · 솔로 · 비활성 반영
- [x] `SyntheticVideoSource`(프레임 번호 · 타임코드 · 챕터 색), `ElementVideoSource`(rVFC 드리프트 보정 · 시크 타임아웃)
- [x] `MockStreamController`: 상태 머신 · 버퍼 · 화질 · 시크 지연 · 대역폭 · 드롭 시뮬레이션
- [x] `buildRenderGraph` + `Compositor`(Canvas2D) + `AudioMixer`(Web Audio)
- [x] 테스트 44개 추가

## Phase 4 — 타임라인 UI · 패널 ✅

- [x] 프리뷰 캔버스(rAF 직접 렌더, composition 해시로 중복 렌더 차단, e2e 용 data 속성)
- [x] 트랜스포트 · 스트리밍 상태 바
- [x] 타임라인 뷰: 룰러 · 마커 · 버퍼 바 · 4트랙 레인 · 파형 · 플레이헤드 · In/Out · 스냅 가이드 · 가상화
- [x] 드래그 이동 · 트림(로컬 미리보기 후 드롭 시 1회 커밋), 분할 · 삭제 · 리플 삭제
- [x] 패널 4종: 목차(검색 · 범위 필터), 강의 자막(선택 · 선택 영역으로 생성), 자동 편집(프리셋 · 규칙 · 가중치 · 리포트), 속성
- [x] 단축키 전체, 자동 저장(5초 디바운스 + 이탈 시 저장), 문제 로그 드로어 · 토스트
- [x] 내 강의 목록 화면

## Phase 5 — 렌더 · 내보내기 · 오류 복구 ✅

- [x] `RenderService`: 프레임 순회 합성, 진행률 · 취소 · 실패 래핑
- [x] 매니페스트 JSON(EDL) · WebVTT · SRT 생성, 프로젝트 JSON 내보내기
- [x] 오류 코드 14종의 복구 정책 구현, `?fail=` 로 실패 주입
- [x] 내보내기 다이얼로그(유효성 차단 · 진행률 · 취소 · 다운로드 · LMS 전송)

## Phase 6 — 브리지 · 배포 ✅

- [x] `PlayerBridge`(postMessage, 버전 · 채널 검증), `LmsBridge`(목업 로그)
- [x] `/bridge-demo`: iframe 임베드 + 메시지 로그 + LMS 이벤트 로그
- [x] GitHub Actions CI(lint · 커버리지 · fixture 재생성 diff · 빌드 · e2e)
- [x] Cloudflare Pages 배포 설정 문서화

## 최종 검사 결과 (2026-09-03)

| 검사 | 결과 |
|---|---|
| `npm run lint` | 오류 0, 경고 0 |
| `npm run test:cov` | 142개 통과. 라인 90.97% · 함수 86.93% · 분기 88.37% (기준 80/80/70) |
| `npm run build` | 성공. JS 337KB (gzip 108KB), CSS 21KB (gzip 5KB) |
| `npm run test:e2e` | 10개 통과 |
| 자동 편집 성능 | 90분 60fps 강의 500ms 미만 |
| 실제 API 호출 | 0건 (fixture 정적 로드만) |

## 남은 사항

- `docs/ISSUE_REPORT_KO.md` 의 open 이슈 4건: 자사 API 명세 수령(#4), 스트리밍 목업의 실연동 교체(#8), 점수 가중치 실데이터 튜닝(#11), 빌드 캐시 재사용 원인 추적(#14)
- WebM 캡처는 선택 기능으로 미구현(계획서에서 선택으로 표기)
