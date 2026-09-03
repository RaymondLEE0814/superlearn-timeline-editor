import { useMemo } from 'react';
import { createServices, servicesFromQuery } from '../services';
import { Toasts } from './common';
import { AppShell } from './app/AppShell';
import { BridgeDemoPage } from './pages/BridgeDemoPage';
import { EditorPage } from './pages/EditorPage';
import { LectureListPage } from './pages/LectureListPage';
import { ServicesContext } from './servicesContext';
import { navigate, useRoute } from './router';

export function App() {
  const route = useRoute();
  const services = useMemo(() => createServices(servicesFromQuery(window.location.search)), []);

  return (
    <ServicesContext.Provider value={services}>
      <AppShell showEditorActions={route.name === 'editor'}>
        {route.name === 'lectures' ? <LectureListPage /> : null}
        {route.name === 'editor' ? (
          <EditorPage key={route.lectureId} lectureId={route.lectureId} />
        ) : null}
        {route.name === 'bridge' ? <BridgeDemoPage /> : null}
        {route.name === 'notfound' ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-gray-500">페이지를 찾을 수 없습니다: {route.path}</p>
            <button
              type="button"
              className="text-xs text-coral underline"
              onClick={() => navigate('/')}
            >
              내 강의로 돌아가기
            </button>
          </div>
        ) : null}
      </AppShell>
      <Toasts />
    </ServicesContext.Provider>
  );
}
