import { useUiStore } from '../../store/uiStore';
import { Button } from '../common';

const SEVERITY_LABEL: Record<string, string> = {
  info: '정보',
  warn: '경고',
  error: '오류',
  fatal: '치명',
};

export function ProblemLogDrawer() {
  const show = useUiStore((s) => s.showProblems);
  const setShow = useUiStore((s) => s.setShowProblems);
  const problems = useUiStore((s) => s.problems);
  const clear = useUiStore((s) => s.clearProblems);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={() => setShow(false)}>
      <aside
        className="flex h-full w-[420px] flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="문제 로그"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-xs font-bold tracking-wide text-coral uppercase">문제 로그</h2>
          <div className="flex gap-2">
            <Button size="sm" onClick={clear} disabled={problems.length === 0}>
              비우기
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShow(false)}>
              닫기
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {problems.length === 0 ? (
            <p className="p-4 text-xs text-gray-400">기록된 문제가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-100" data-testid="problem-list">
              {[...problems].reverse().map((p, i) => (
                <li key={`${p.at}-${i}`} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        p.severity === 'error' || p.severity === 'fatal'
                          ? 'bg-coral-50 text-coral'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {SEVERITY_LABEL[p.severity] ?? p.severity}
                    </span>
                    <code className="font-mono text-[11px] text-gray-500">{p.code}</code>
                    <span className="ml-auto font-mono text-[10px] text-gray-400">
                      {p.at.slice(11, 19)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-700">{p.message}</p>
                  {p.context ? (
                    <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 font-mono text-[10px] text-gray-500">
                      {JSON.stringify(p.context, null, 1)}
                    </pre>
                  ) : null}
                  {p.recoverable ? (
                    <p className="mt-1 text-[10px] text-gray-400">복구 가능 · 재시도할 수 있습니다</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
