import { useEffect, useRef, useState } from 'react';
import { BRIDGE_CHANNEL, BRIDGE_VERSION } from '../../engine/api/bridge';
import { Button } from '../common';
import { useServices } from '../servicesContext';

interface LogRow {
  dir: '→ 편집기' | '← 편집기';
  type: string;
  payload: unknown;
  at: string;
}

/**
 * 자사 플레이어가 편집기를 iframe 으로 임베드하는 상황을 흉내 낸 데모.
 * 실제 연동 전에 메시지 계약을 눈으로 확인하기 위한 화면이다.
 */
export function BridgeDemoPage() {
  const services = useServices();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [lmsLog, setLmsLog] = useState(services.lms.getLog());

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { channel?: string; type?: string; payload?: unknown } | null;
      if (!d || d.channel !== BRIDGE_CHANNEL) return;
      setLog((l) =>
        [
          { dir: '← 편집기' as const, type: d.type ?? '?', payload: d.payload, at: new Date().toLocaleTimeString('ko-KR') },
          ...l,
        ].slice(0, 60),
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const send = (type: string, payload: unknown) => {
    frameRef.current?.contentWindow?.postMessage(
      { channel: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type, payload },
      '*',
    );
    setLog((l) =>
      [{ dir: '→ 편집기' as const, type, payload, at: new Date().toLocaleTimeString('ko-KR') }, ...l].slice(0, 60),
    );
  };

  const editorUrl = `${import.meta.env.BASE_URL}editor/short-demo`;

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-[62] flex-col border-r border-gray-200">
        <div className="border-b border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-500">
          자사 플레이어 (호스트) · 아래 iframe 이 편집기입니다
        </div>
        <iframe
          ref={frameRef}
          src={editorUrl}
          title="슈퍼런 타임라인 편집기"
          className="min-h-0 flex-1 border-0"
        />
      </section>

      <aside className="flex min-w-0 flex-[38] flex-col bg-white">
        <div className="space-y-2 border-b border-gray-200 p-3">
          <p className="text-[11px] font-bold tracking-wide text-coral uppercase">
            PlayerBridge 메시지 보내기
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => send('open', { lectureId: 'short-demo' })}>
              open(short-demo)
            </Button>
            <Button size="sm" onClick={() => send('seek', { sec: 30 })}>
              seek(00:30)
            </Button>
            <Button size="sm" onClick={() => send('seek', { frame: 500 })}>
              seek(frame 500)
            </Button>
            <Button
              size="sm"
              onClick={() => send('select-transcript', { segmentIds: ['seg0002', 'seg0003', 'seg0004'] })}
            >
              select-transcript
            </Button>
            <Button size="sm" onClick={() => send('request-export', { opts: {} })}>
              request-export
            </Button>
            <Button size="sm" variant="danger" onClick={() => send('bogus', { x: 1 })}>
              잘못된 메시지
            </Button>
          </div>
          <p className="text-[10px] text-gray-400">
            메시지 형식: {`{ channel: "${BRIDGE_CHANNEL}", v: ${BRIDGE_VERSION}, type, payload }`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="bridge-log">
          <ul className="divide-y divide-gray-100">
            {log.map((r, i) => (
              <li key={i} className="px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] ${r.dir === '← 편집기' ? 'text-coral' : 'text-gray-500'}`}
                  >
                    {r.dir}
                  </span>
                  <code className="font-mono text-[11px] text-gray-800">{r.type}</code>
                  <span className="ml-auto font-mono text-[9px] text-gray-400">{r.at}</span>
                </div>
                <pre className="mt-0.5 overflow-x-auto font-mono text-[10px] text-gray-500">
                  {JSON.stringify(r.payload)}
                </pre>
              </li>
            ))}
            {log.length === 0 ? (
              <li className="px-3 py-4 text-[11px] text-gray-400">아직 메시지가 없습니다.</li>
            ) : null}
          </ul>
        </div>

        <div className="border-t border-gray-200 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold tracking-wide text-coral uppercase">LMS 이벤트 로그</p>
            <Button size="sm" variant="ghost" onClick={() => setLmsLog(services.lms.getLog())}>
              새로고침
            </Button>
          </div>
          <ul className="mt-1 max-h-32 overflow-y-auto">
            {lmsLog.slice(-20).reverse().map((e, i) => (
              <li key={i} className="font-mono text-[10px] text-gray-500">
                {e.at.slice(11, 19)} · {e.verb} · {e.lectureId}
              </li>
            ))}
            {lmsLog.length === 0 ? (
              <li className="text-[10px] text-gray-400">기록 없음</li>
            ) : null}
          </ul>
        </div>
      </aside>
    </div>
  );
}
