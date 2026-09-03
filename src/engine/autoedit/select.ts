import type {
  AutoEditPreset,
  AutoEditRules,
  Id,
  MediaMetadata,
  RemovalReason,
  ScoredSegment,
} from '../types';

export interface SelectionResult {
  selected: ScoredSegment[];
  /** 제외된 세그먼트 id -> 사유 */
  excluded: Map<Id, RemovalReason>;
  warnings: string[];
}

function segDuration(s: ScoredSegment): number {
  return s.endFrame - s.startFrame;
}

/** 시간상 맞닿은 세그먼트를 하나로 합친다. */
function mergeAdjacent(segs: ScoredSegment[]): ScoredSegment[] {
  const sorted = [...segs].sort((a, b) => a.startFrame - b.startFrame);
  const out: ScoredSegment[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.startFrame <= last.endFrame) {
      out[out.length - 1] = {
        ...last,
        endFrame: Math.max(last.endFrame, s.endFrame),
        score: Math.max(last.score, s.score),
        reasons: [...new Set([...last.reasons, ...s.reasons])],
        boundaryKinds: [...new Set([...last.boundaryKinds, ...s.boundaryKinds])],
      };
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/** 세그먼트가 속한 말단 챕터. */
function leafChapterOf(meta: MediaMetadata, frame: number): string | undefined {
  const leaves = meta.chapters.filter((c) => !meta.chapters.some((o) => o.parentId === c.id));
  return leaves.find((c) => frame >= c.startFrame && frame < c.endFrame)?.id;
}

export function selectSegments(
  scored: ScoredSegment[],
  preset: AutoEditPreset,
  rules: AutoEditRules,
  meta: MediaMetadata,
): SelectionResult {
  const excluded = new Map<Id, RemovalReason>();
  const warnings: string[] = [];

  if (scored.length === 0) {
    warnings.push('편집 가능한 구간을 찾지 못했습니다. 무음 임계값을 확인하세요.');
    return { selected: [], excluded, warnings };
  }

  switch (preset) {
    case 'silence-trim':
      return { selected: [...scored], excluded, warnings };

    case 'chapter-cut': {
      // 챕터 단위로 하나의 연속 클립을 만든다. 챕터 앞뒤 무음만 잘라낸다.
      const byChapter = new Map<string, ScoredSegment[]>();
      for (const s of scored) {
        const key = leafChapterOf(meta, s.startFrame) ?? '__none';
        const list = byChapter.get(key);
        if (list) list.push(s);
        else byChapter.set(key, [s]);
      }
      const selected: ScoredSegment[] = [];
      for (const [chapterId, list] of byChapter) {
        const start = Math.min(...list.map((s) => s.startFrame));
        const end = Math.max(...list.map((s) => s.endFrame));
        const chapter = meta.chapters.find((c) => c.id === chapterId);
        selected.push({
          id: `cut_${chapterId}`,
          startFrame: start,
          endFrame: end,
          chapterId: chapterId === '__none' ? undefined : chapterId,
          boundaryKinds: ['chapter'],
          score: Math.max(...list.map((s) => s.score)),
          reasons: chapter ? [`chapter:${chapter.title}`] : ['chapter-cut'],
          parts: list[0].parts,
        });
      }
      selected.sort((a, b) => a.startFrame - b.startFrame);
      return { selected, excluded, warnings };
    }

    case 'highlight': {
      const target = rules.targetDurationFrames;
      if (!target || target <= 0) {
        warnings.push('목표 길이가 없어 상위 20% 세그먼트만 선택했습니다.');
        const sorted = [...scored].sort((a, b) => b.score - a.score);
        const take = Math.max(1, Math.round(sorted.length * 0.2));
        for (const s of sorted.slice(take)) excluded.set(s.id, 'low-score');
        return {
          selected: sorted.slice(0, take).sort((a, b) => a.startFrame - b.startFrame),
          excluded,
          warnings,
        };
      }
      const byScore = [...scored].sort(
        (a, b) => b.score - a.score || a.startFrame - b.startFrame,
      );
      const selected: ScoredSegment[] = [];
      let total = 0;
      for (const s of byScore) {
        const d = segDuration(s);
        if (total + d <= target) {
          selected.push(s);
          total += d;
        } else {
          excluded.set(s.id, 'over-target');
        }
      }
      if (selected.length === 0) {
        // 목표가 너무 짧으면 최고 점수 하나는 남긴다.
        const best = byScore[0];
        selected.push(best);
        excluded.delete(best.id);
        warnings.push('목표 길이가 가장 짧은 구간보다 짧아 최고 점수 구간 1개만 남겼습니다.');
      }
      const selectedIds = new Set(selected.map((s) => s.id));
      for (const s of scored) if (!selectedIds.has(s.id) && !excluded.has(s.id)) excluded.set(s.id, 'low-score');
      return { selected: selected.sort((a, b) => a.startFrame - b.startFrame), excluded, warnings };
    }

    case 'from-selection': {
      const ids = new Set(rules.selectedTranscriptIds ?? []);
      if (ids.size === 0) {
        warnings.push('선택된 자막 구간이 없습니다.');
        for (const s of scored) excluded.set(s.id, 'unselected');
        return { selected: [], excluded, warnings };
      }
      const ranges = meta.transcript.segments.filter((t) => ids.has(t.id));
      const selected = scored.filter((s) =>
        ranges.some((r) => r.endFrame > s.startFrame && r.startFrame < s.endFrame),
      );
      const selectedIds = new Set(selected.map((s) => s.id));
      for (const s of scored) if (!selectedIds.has(s.id)) excluded.set(s.id, 'unselected');
      return { selected: mergeAdjacent(selected), excluded, warnings };
    }
  }
}
