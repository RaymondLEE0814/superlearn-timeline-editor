import { FPS_25, FPS_30, FPS_60 } from '../engine/timebase';
import type { LectureSpec } from './lectureGen';

/**
 * 참조 화면(슈퍼런 실제 플레이어)의 목차를 그대로 옮긴 강의.
 * 참조 이미지의 목차 길이 합(74:06)이 표시 길이(45:32)와 맞지 않아
 * 길이는 상대 비중으로만 쓰고 전체를 45:32 에 맞춰 정규화한다.
 */
export const CALC_30: LectureSpec = {
  mediaId: 'calc-30-derivatives',
  title: '[30] 미적분학 3_2. 도함수의 정의',
  breadcrumbs: ['내 강의', '[2028 수학 마스터 커리큘럼]', '(미적분학 I)', '미분법', '[30] 미적분학 3_2. 도함수의 정의'],
  fps: FPS_30,
  width: 1920,
  height: 1080,
  totalClock: '45:32',
  keyframeIntervalSec: 2,
  seed: 20260903,
  keywords: [
    '도함수',
    '극한',
    '미분계수',
    '접선',
    '연쇄법칙',
    '거듭제곱',
    '곱의 미분법',
    '몫의 미분법',
    '증가와 감소',
    '최댓값',
    '최적화',
    '변화율',
  ],
  chapters: [
    { title: '도함수 소개', fixedSec: 60 },
    {
      title: '1. 도함수의 개념',
      leaves: [
        { title: '1-1. 도함수의 정의', clock: '01:58' },
        { title: '1-2. 도함수의 기하학적 의미', clock: '02:53' },
        { title: '1-3. 기본 미분법', clock: '04:17' },
      ],
    },
    {
      title: '2. 기본 함수의 미분',
      leaves: [
        { title: '2-1. 거듭제곱 미분법', clock: '07:21' },
        { title: '2-2. 곱의 미분법', clock: '05:40' },
        { title: '2-3. 몫의 미분법', clock: '04:31' },
        { title: '2-4. 연쇄 법칙', clock: '03:20' },
      ],
    },
    {
      title: '3. 도함수의 활용',
      leaves: [
        { title: '3-1. 함수의 증가와 감소', clock: '06:03' },
        { title: '3-2. 최댓값·최솟값 문제', clock: '06:29' },
        { title: '3-3. 최적화 문제', clock: '06:13' },
      ],
    },
    {
      title: '4. 관련 변화율',
      leaves: [
        { title: '4-1. 기본 개념', clock: '04:12' },
        { title: '4-2. 문제 풀이', clock: '05:44' },
      ],
    },
    {
      title: '5. 연습문제',
      leaves: [
        { title: '5-1. 수준 1 문제', clock: '04:36' },
        { title: '5-2. 수준 2 문제', clock: '05:12' },
        { title: '5-3. 수준 3 문제', clock: '05:57' },
      ],
    },
  ],
};

/** e2e · 단위 테스트용 짧은 강의. 25fps 로 fps 비의존성을 검증한다. */
export const SHORT_DEMO: LectureSpec = {
  mediaId: 'short-demo',
  title: '[데모] 극한의 뜻 3분 요약',
  breadcrumbs: ['내 강의', '(미적분학 I)', '[데모] 극한의 뜻 3분 요약'],
  fps: FPS_25,
  width: 1280,
  height: 720,
  totalClock: '03:00',
  keyframeIntervalSec: 2,
  seed: 7,
  keywords: ['극한', '수렴', '발산'],
  chapters: [
    { title: '도입', fixedSec: 20 },
    {
      title: '1. 극한의 정의',
      leaves: [
        { title: '1-1. 좌극한과 우극한', clock: '01:00' },
        { title: '1-2. 수렴과 발산', clock: '00:40' },
      ],
    },
    {
      title: '2. 예제',
      leaves: [{ title: '2-1. 기본 예제', clock: '01:00' }],
    },
  ],
};

/** 성능 확인용 90분 강의. 파일로 커밋하지 않고 런타임에 생성한다. */
export const LONG_90: LectureSpec = {
  mediaId: 'long-90',
  title: '[성능] 90분 강의 (런타임 생성)',
  breadcrumbs: ['내 강의', '[성능] 90분 강의'],
  fps: FPS_60,
  width: 1920,
  height: 1080,
  totalClock: '90:00',
  keyframeIntervalSec: 2,
  seed: 4242,
  keywords: ['도함수', '적분', '급수', '수열', '벡터', '행렬'],
  chapters: Array.from({ length: 9 }, (_, i) => ({
    title: `${i + 1}. 단원 ${i + 1}`,
    leaves: Array.from({ length: 4 }, (_, j) => ({
      title: `${i + 1}-${j + 1}. 소단원 ${j + 1}`,
      clock: '02:30',
    })),
  })),
};

export const FIXTURE_SPECS = [CALC_30, SHORT_DEMO];
