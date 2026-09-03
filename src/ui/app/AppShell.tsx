import type { ReactNode } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useUiStore } from '../../store/uiStore';
import { Button } from '../common';
import { navigate } from '../router';
import { ProblemLogDrawer } from './ProblemLogDrawer';

const NAV = [
  '내 강의',
  '연습 퀴즈',
  '내 노트',
  '질문과 답변',
  '학습 자료',
  '다운로드',
  '공지사항',
  '업로드',
  '더보기',
];

export function AppShell({
  children,
  showEditorActions,
}: {
  children: ReactNode;
  showEditorActions: boolean;
}) {
  const problems = useUiStore((s) => s.problems);
  const setShowProblems = useUiStore((s) => s.setShowProblems);
  const setShowExport = useUiStore((s) => s.setShowExport);
  const savedAt = useUiStore((s) => s.savedAt);
  const dirty = useEditorStore((s) => s.dirty);
  const hasTimeline = useEditorStore((s) => s.timeline != null);

  const errorCount = problems.filter((p) => p.severity === 'error' || p.severity === 'fatal').length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-gray-200 bg-white px-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm font-bold text-coral"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-coral text-[10px] text-white">
            ▶
          </span>
          슈퍼런
        </button>
        <nav className="hidden items-center gap-3 lg:flex">
          {NAV.map((n) => (
            <span key={n} className="text-[11px] text-gray-400">
              {n}
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {showEditorActions ? (
            <span className="text-[11px] text-gray-400">
              {dirty ? '저장 중…' : savedAt ? `저장됨 · ${savedAt}` : '변경 없음'}
            </span>
          ) : null}
          <Button onClick={() => navigate('/bridge-demo')} size="sm" variant="ghost">
            브리지 데모
          </Button>
          <Button
            onClick={() => setShowProblems(true)}
            size="sm"
            variant={errorCount > 0 ? 'danger' : 'default'}
            testId="btn-problems"
          >
            문제 로그{problems.length > 0 ? ` (${problems.length})` : ''}
          </Button>
          {showEditorActions ? (
            <Button
              onClick={() => setShowExport(true)}
              size="sm"
              variant="primary"
              disabled={!hasTimeline}
              testId="btn-export"
            >
              내보내기
            </Button>
          ) : null}
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
      <ProblemLogDrawer />
    </div>
  );
}
