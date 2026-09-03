import { useState } from 'react';
import { fpsToNumber, formatClock, secToFrame } from '../../engine/timebase';
import type { AutoEditPreset } from '../../engine/types';
import { useEditorStore } from '../../store/editorStore';
import { useUiStore } from '../../store/uiStore';
import { Button, NumberField, Slider, Toggle } from '../common';

const PRESETS: Array<{ id: AutoEditPreset; label: string; desc: string }> = [
  { id: 'silence-trim', label: '무음 제거', desc: '유효 무음을 지우고 갭 없이 이어 붙입니다.' },
  { id: 'chapter-cut', label: '챕터별 컷', desc: '말단 챕터마다 하나의 연속 클립을 만듭니다.' },
  { id: 'highlight', label: '하이라이트 추출', desc: '점수 상위 구간을 목표 길이까지 담습니다.' },
  { id: 'from-selection', label: '선택 영역으로 생성', desc: '강의 자막에서 고른 구간만 남깁니다.' },
];

const REASON_LABEL: Record<string, string> = {
  silence: '무음',
  unselected: '미선택',
  'low-score': '낮은 점수',
  'over-target': '목표 초과',
};

export function AutoEditPanel() {
  const meta = useEditorStore((s) => s.meta);
  const rules = useEditorStore((s) => s.rules);
  const report = useEditorStore((s) => s.report);
  const preset = useEditorStore((s) => s.preset);
  const setRules = useEditorStore((s) => s.setRules);
  const runAutoEdit = useEditorStore((s) => s.runAutoEdit);
  const transcriptSelection = useEditorStore((s) => s.transcriptSelection);
  const analysis = useUiStore((s) => s.analysis);
  const [targetMin, setTargetMin] = useState(5);
  const [showCandidates, setShowCandidates] = useState(false);

  if (!meta || !rules) return null;
  const fps = meta.stream.fps;
  const fpsNum = fpsToNumber(fps);

  const run = (p: AutoEditPreset) => {
    runAutoEdit(p, p === 'highlight' ? { targetDurationFrames: Math.round(targetMin * 60 * fpsNum) } : undefined);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {analysis.running ? (
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-[11px] text-gray-600">
            분석 중 · {analysis.stage ?? ''} ({analysis.pct}%)
          </p>
          <div className="mt-1 h-1 w-full rounded bg-gray-200">
            <div className="h-1 rounded bg-coral" style={{ width: `${analysis.pct}%` }} />
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 p-3">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => run(p.id)}
            disabled={p.id === 'from-selection' && transcriptSelection.length === 0}
            className={`rounded border p-2 text-left transition-colors disabled:opacity-40 ${
              preset === p.id ? 'border-coral bg-coral-50' : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
            data-testid={`preset-${p.id}`}
          >
            <p className="text-[11px] font-semibold text-gray-800">{p.label}</p>
            <p className="mt-0.5 text-[10px] leading-tight text-gray-500">{p.desc}</p>
          </button>
        ))}
      </div>

      <div className="space-y-2 border-t border-gray-200 px-3 py-3">
        <p className="text-[10px] font-bold tracking-wide text-gray-400 uppercase">규칙</p>
        <NumberField
          label="무음 임계"
          value={rules.silenceThresholdDb}
          onChange={(v) => setRules({ silenceThresholdDb: v })}
          suffix="dB"
          step={1}
        />
        <NumberField
          label="최소 무음"
          value={Number((rules.minSilenceFrames / fpsNum).toFixed(2))}
          onChange={(v) => setRules({ minSilenceFrames: secToFrame(v, fps, 'round') })}
          suffix="초"
          step={0.1}
          min={0}
        />
        <NumberField
          label="패딩"
          value={Number((rules.paddingFrames / fpsNum).toFixed(2))}
          onChange={(v) => setRules({ paddingFrames: secToFrame(v, fps, 'round') })}
          suffix="초"
          step={0.05}
          min={0}
        />
        <NumberField
          label="최소 구간"
          value={Number((rules.minSegmentFrames / fpsNum).toFixed(1))}
          onChange={(v) => setRules({ minSegmentFrames: secToFrame(v, fps, 'round') })}
          suffix="초"
          step={0.5}
          min={0.1}
        />
        <NumberField
          label="최대 구간"
          value={Number((rules.maxSegmentFrames / fpsNum).toFixed(0))}
          onChange={(v) => setRules({ maxSegmentFrames: secToFrame(v, fps, 'round') })}
          suffix="초"
          step={10}
          min={1}
        />
        <NumberField
          label="하이라이트 목표"
          value={targetMin}
          onChange={setTargetMin}
          suffix="분"
          step={1}
          min={1}
        />
        <Toggle
          label="키프레임에 컷 맞추기 (스트리밍 친화)"
          checked={rules.snapToKeyframe}
          onChange={(v) => setRules({ snapToKeyframe: v })}
        />
      </div>

      <div className="space-y-1.5 border-t border-gray-200 px-3 py-3">
        <p className="text-[10px] font-bold tracking-wide text-gray-400 uppercase">점수 가중치</p>
        {(
          [
            ['chapterStart', '챕터 시작'],
            ['keyword', '키워드 밀도'],
            ['energy', '음성 에너지'],
            ['slide', '슬라이드 전환'],
            ['board', '판서 활동'],
          ] as const
        ).map(([key, label]) => (
          <Slider
            key={key}
            label={label}
            value={rules.scoreWeights[key]}
            onChange={(v) => setRules({ scoreWeights: { ...rules.scoreWeights, [key]: v } })}
          />
        ))}
      </div>

      {report ? (
        <div className="border-t border-gray-200 px-3 py-3" data-testid="autoedit-report">
          <p className="text-[10px] font-bold tracking-wide text-gray-400 uppercase">결과</p>
          <p className="mt-1 text-xs text-gray-800">
            원본 {formatClock(report.sourceDurationFrames, fps)} → 결과{' '}
            <span className="font-semibold text-coral" data-testid="report-result">
              {formatClock(report.resultDurationFrames, fps)}
            </span>{' '}
            <span className="text-gray-500">(−{formatClock(report.savedFrames, fps)})</span>
          </p>
          <p className="mt-1 text-[10px] text-gray-500">
            선택 구간 {report.segments.length}개 · 후보 {report.candidates.length}개 · 제거{' '}
            {report.removed.length}개
          </p>
          {report.warnings.map((w) => (
            <p key={w} className="mt-1 text-[10px] text-coral">
              {w}
            </p>
          ))}

          <button
            type="button"
            className="mt-2 text-[10px] text-gray-500 underline"
            onClick={() => setShowCandidates(!showCandidates)}
          >
            {showCandidates ? '근거 접기' : '구간별 근거 보기'}
          </button>

          {showCandidates ? (
            <div className="mt-2 max-h-64 overflow-y-auto rounded border border-gray-200">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-1.5 py-1 text-left">시작</th>
                    <th className="px-1.5 py-1 text-right">점수</th>
                    <th className="px-1.5 py-1 text-left">근거</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.segments.slice(0, 200).map((s) => (
                    <tr key={s.id}>
                      <td className="px-1.5 py-1 font-mono text-gray-500">
                        {formatClock(s.startFrame, fps)}
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono text-gray-700">
                        {(s.score * 100).toFixed(0)}
                      </td>
                      <td className="px-1.5 py-1 text-gray-500">
                        {s.reasons.join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <p className="mt-3 text-[10px] font-bold tracking-wide text-gray-400 uppercase">
            제거 구간
          </p>
          <div className="mt-1 max-h-40 overflow-y-auto rounded border border-gray-200">
            <table className="w-full text-[10px]">
              <tbody className="divide-y divide-gray-100">
                {report.removed.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td className="px-1.5 py-1 font-mono text-gray-500">
                      {formatClock(r.startFrame, fps)} – {formatClock(r.endFrame, fps)}
                    </td>
                    <td className="px-1.5 py-1 text-right text-gray-500">
                      {REASON_LABEL[r.reason] ?? r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-200 px-3 py-6 text-center text-[11px] text-gray-400">
          프리셋을 눌러 자동 편집을 실행하세요.
        </div>
      )}

      <div className="mt-auto border-t border-gray-200 p-3">
        <Button variant="primary" onClick={() => run(preset)}>
          현재 설정으로 다시 실행
        </Button>
      </div>
    </div>
  );
}
