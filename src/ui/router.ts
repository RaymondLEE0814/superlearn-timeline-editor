import { useEffect, useState } from 'react';

export type Route =
  | { name: 'lectures' }
  | { name: 'editor'; lectureId: string }
  | { name: 'bridge' }
  | { name: 'notfound'; path: string };

export function parsePath(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return { name: 'lectures' };
  if (clean === '/bridge-demo') return { name: 'bridge' };
  const m = /^\/editor\/([^/]+)$/.exec(clean);
  if (m) return { name: 'editor', lectureId: decodeURIComponent(m[1]) };
  return { name: 'notfound', path: clean };
}

function currentPath(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = window.location.pathname;
  return base && p.startsWith(base) ? p.slice(base.length) || '/' : p;
}

export function navigate(to: string): void {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  window.history.pushState({}, '', `${base}${to}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePath(currentPath()));
  useEffect(() => {
    const onPop = () => setRoute(parsePath(currentPath()));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}
