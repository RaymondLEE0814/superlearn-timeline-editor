import { useEffect, useState } from 'react';
import { errorBus, toEngineError } from '../../engine/errors';
import { formatClock } from '../../engine/timebase';
import type { LectureSummary } from '../../engine/types';
import { Button } from '../common';
import { navigate } from '../router';
import { useServices } from '../servicesContext';

export function LectureListPage() {
  const services = useServices();
  const [lectures, setLectures] = useState<LectureSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    services.media
      .listLectures()
      .then(setLectures)
      .catch((e) => {
        const err = toEngineError(e);
        errorBus.report(err);
        setError(err.message);
      });
  };

  useEffect(load, [services]);

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-lg font-bold text-gray-800">내 강의</h1>
      <p className="mt-1 text-xs text-gray-500">
        강의를 열면 타임라인 기반 자동 편집기와 프레임 단위 뷰어가 시작됩니다. 모든 데이터는 목업입니다.
      </p>

      {error ? (
        <div className="mt-6 rounded border border-coral bg-coral-50 p-4">
          <p className="text-xs text-coral">{error}</p>
          <Button size="sm" onClick={load}>
            다시 시도
          </Button>
        </div>
      ) : null}

      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="lecture-list">
        {(lectures ?? []).map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => navigate(`/editor/${encodeURIComponent(l.id)}`)}
              className="w-full overflow-hidden rounded border border-gray-200 bg-white text-left transition-shadow hover:shadow-md"
              data-testid={`lecture-${l.id}`}
            >
              <div className="grid h-32 place-items-center bg-[#1f3a2e] text-white">
                <span className="font-mono text-xs opacity-70">{l.id}</span>
              </div>
              <div className="p-3">
                <p className="truncate text-xs font-semibold text-gray-800">{l.title}</p>
                <p className="mt-1 truncate text-[10px] text-gray-400">
                  {l.breadcrumbs.slice(1, -1).join(' › ')}
                </p>
                <p className="mt-2 font-mono text-[10px] text-gray-500">
                  {formatClock(l.durationFrames, l.fps)} ·{' '}
                  {Math.round((l.fps.num / l.fps.den) * 100) / 100}fps ·{' '}
                  {l.analyzed ? '분석 완료' : '미분석'}
                </p>
              </div>
            </button>
          </li>
        ))}
        {lectures === null && !error
          ? Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="h-52 animate-pulse rounded border border-gray-200 bg-white" />
            ))
          : null}
      </ul>
    </div>
  );
}
