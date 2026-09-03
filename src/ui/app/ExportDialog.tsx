import { useState } from 'react';
import { toEngineError } from '../../engine/errors';
import { toVtt } from '../../engine/render/subtitles';
import { formatClock } from '../../engine/timebase';
import type { RenderManifest, RenderOutputs } from '../../engine/types';
import { useEditorStore } from '../../store/editorStore';
import { useUiStore } from '../../store/uiStore';
import { Button, Toggle } from '../common';
import { useRequiredSession, useServices } from '../servicesContext';

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ExportDialog() {
  const show = useUiStore((s) => s.showExport);
  const setShow = useUiStore((s) => s.setShowExport);
  const notify = useUiStore((s) => s.notify);
  const session = useRequiredSession();
  const services = useServices();
  const timeline = useEditorStore((s) => s.timeline);
  const issues = useEditorStore((s) => s.issues);
  const report = useEditorStore((s) => s.report);

  const [opts, setOpts] = useState({ manifest: true, vtt: true, srt: false });
  const [progress, setProgress] = useState<{ frame: number; total: number } | null>(null);
  const [outputs, setOutputs] = useState<RenderOutputs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null);

  if (!show || !timeline) return null;

  const start = () => {
    setError(null);
    setOutputs(null);
    try {
      const handle = session.render.startRender(timeline, {
        ...opts,
        captureWebm: false,
        framesPerTick: 900,
      });
      setCancelFn(() => handle.cancel);
      const off = session.render.events.on('progress', (p) => {
        if (p.jobId === handle.jobId) setProgress({ frame: p.frame, total: p.total });
      });
      handle.result
        .then((out) => {
          setOutputs(out);
          setProgress(null);
          notify('내보내기를 마쳤습니다.');
        })
        .catch((e) => {
          const err = toEngineError(e);
          setProgress(null);
          if (err.code !== 'RENDER_ABORTED') setError(err.message);
          else notify('내보내기를 취소했습니다.');
        })
        .finally(() => {
          off();
          setCancelFn(null);
        });
    } catch (e) {
      setError(toEngineError(e).message);
    }
  };

  const publishToLms = async () => {
    if (!outputs?.manifestJson) return;
    const manifest = JSON.parse(await outputs.manifestJson.text()) as RenderManifest;
    const res = await services.lms.publish({
      lectureId: timeline.mediaId,
      manifest,
      title: timeline.name,
      kind: report?.preset === 'highlight' ? 'highlight' : report?.preset === 'chapter-cut' ? 'chapter-clips' : 'trimmed',
    });
    notify(`LMS 에 학습 자료로 등록했습니다 (목업): ${res.materialId}`);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-[440px] rounded border border-gray-200 bg-white shadow-xl" role="dialog" aria-label="내보내기">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-xs font-bold tracking-wide text-coral uppercase">내보내기</h2>
          <Button size="sm" variant="ghost" onClick={() => setShow(false)}>
            닫기
          </Button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="rounded bg-gray-50 p-2 text-[11px] text-gray-600">
            <p>
              길이 {formatClock(session.clock.duration, timeline.fps)} · 클립{' '}
              {timeline.tracks.reduce((n, t) => n + t.clips.length, 0)}개
            </p>
            <p className={issues.length > 0 ? 'text-coral' : 'text-gray-500'}>
              유효성 {issues.length === 0 ? '✓ 문제 없음' : `⚠ 오류 ${issues.length}건 (내보낼 수 없습니다)`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Toggle
              label="편집 매니페스트 (JSON · EDL)"
              checked={opts.manifest}
              onChange={(v) => setOpts({ ...opts, manifest: v })}
            />
            <Toggle label="자막 WebVTT" checked={opts.vtt} onChange={(v) => setOpts({ ...opts, vtt: v })} />
            <Toggle label="자막 SRT" checked={opts.srt} onChange={(v) => setOpts({ ...opts, srt: v })} />
            <p className="text-[10px] text-gray-400">
              MVP 는 실제 인코딩 대신 전체 프레임을 합성해 편집 결과를 검증하고 매니페스트를 만듭니다.
            </p>
          </div>

          {progress ? (
            <div>
              <div className="h-1.5 w-full rounded bg-gray-200">
                <div
                  className="h-1.5 rounded bg-coral transition-[width]"
                  style={{ width: `${(progress.frame / progress.total) * 100}%` }}
                />
              </div>
              <p className="mt-1 font-mono text-[10px] text-gray-500" data-testid="export-progress">
                {progress.frame} / {progress.total}
              </p>
            </div>
          ) : null}

          {error ? <p className="text-[11px] text-coral">{error}</p> : null}

          {outputs ? (
            <div className="space-y-1.5 rounded border border-gray-200 p-2" data-testid="export-done">
              <p className="text-[11px] font-semibold text-gray-700">산출물</p>
              {outputs.manifestJson ? (
                <button
                  type="button"
                  className="block text-[11px] text-coral underline"
                  onClick={() => download(outputs.manifestJson!, `${timeline.mediaId}.manifest.json`)}
                >
                  매니페스트 내려받기
                </button>
              ) : null}
              {outputs.subtitlesVtt ? (
                <button
                  type="button"
                  className="block text-[11px] text-coral underline"
                  onClick={() => download(outputs.subtitlesVtt!, `${timeline.mediaId}.vtt`)}
                >
                  WebVTT 내려받기
                </button>
              ) : null}
              {outputs.subtitlesSrt ? (
                <button
                  type="button"
                  className="block text-[11px] text-coral underline"
                  onClick={() => download(outputs.subtitlesSrt!, `${timeline.mediaId}.srt`)}
                >
                  SRT 내려받기
                </button>
              ) : null}
              <button
                type="button"
                className="block text-[11px] text-gray-600 underline"
                onClick={() => download(services.project.exportJson(timeline), `${timeline.mediaId}.project.json`)}
              >
                프로젝트 JSON 내려받기
              </button>
              <button
                type="button"
                className="mt-1 block text-[11px] text-gray-600 underline"
                onClick={() => void publishToLms()}
              >
                LMS 로 보내기 (목업)
              </button>
              <p className="pt-1 font-mono text-[10px] text-gray-400">
                자막 큐 {toVtt(timeline).split('-->').length - 1}개
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
          {cancelFn ? (
            <Button onClick={() => cancelFn()} variant="danger">
              취소
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={start}
            disabled={issues.length > 0 || progress != null}
            testId="btn-start-export"
          >
            내보내기 실행
          </Button>
        </div>
      </div>
    </div>
  );
}
