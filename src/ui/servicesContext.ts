import { createContext, useContext } from 'react';
import type { AppServices } from '../services';
import type { EditorSession } from '../session/EditorSession';

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext 가 없습니다.');
  return s;
}

export const SessionContext = createContext<EditorSession | null>(null);

export function useSession(): EditorSession | null {
  return useContext(SessionContext);
}

export function useRequiredSession(): EditorSession {
  const s = useContext(SessionContext);
  if (!s) throw new Error('EditorSession 이 없습니다.');
  return s;
}
