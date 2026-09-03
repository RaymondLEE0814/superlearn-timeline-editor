import { clipFadeGain, dbToLinear, resolve } from '../playback/sync';
import type { CompAudio, CompLayer, Frame, FrameComposition, Timeline } from '../types';

function hashComposition(frame: Frame, layers: CompLayer[], audio: CompAudio[]): string {
  const parts: string[] = [String(frame)];
  for (const l of layers) {
    switch (l.kind) {
      case 'video':
        parts.push(`v:${l.sourceId}:${l.sourceFrame}:${l.opacity}`);
        break;
      case 'overlay':
        parts.push(`o:${l.imageRef}:${l.opacity}`);
        break;
      case 'subtitle':
        parts.push(`s:${l.text}:${l.style.fontSizePx}:${l.style.position}`);
        break;
      case 'gap':
        parts.push('gap');
        break;
    }
  }
  for (const a of audio) parts.push(`a:${a.clipId}:${a.gain.toFixed(3)}`);
  return parts.join('|');
}

/**
 * 한 프레임의 렌더 그래프를 만든다.
 * z 순서는 영상 < 오버레이 < 자막 으로 고정한다.
 */
export function buildRenderGraph(timeline: Timeline, frame: Frame): FrameComposition {
  const p = resolve(timeline, frame);
  const layers: CompLayer[] = [];

  if (p.videoClip && p.sourceFrame != null) {
    layers.push({
      kind: 'video',
      sourceId: p.videoClip.sourceId,
      sourceFrame: p.sourceFrame,
      opacity: 1,
    });
  } else {
    layers.push({ kind: 'gap' });
  }

  for (const o of p.overlayClips) {
    if (!o.overlay) continue;
    layers.push({
      kind: 'overlay',
      imageRef: o.overlay.imageRef,
      overlayKind: o.overlay.kind,
      rect: o.overlay.rect,
      opacity: o.overlay.opacity,
    });
  }

  // 같은 프레임에 자막이 여럿이면 가장 늦게 시작한 것을 쓴다.
  const sub = [...p.subtitleClips].sort((a, b) => a.startFrame - b.startFrame).pop();
  if (sub?.subtitle) {
    layers.push({ kind: 'subtitle', text: sub.subtitle.text, style: sub.subtitle.style });
  }

  const audio: CompAudio[] = p.audioClips.map((c) => ({
    clipId: c.id,
    sourceId: c.sourceId,
    sourceFrame: c.sourceInFrame + (frame - c.startFrame),
    gain: dbToLinear(c.gain ?? 0) * clipFadeGain(c, frame),
  }));

  return {
    frame,
    size: { w: timeline.width, h: timeline.height },
    hash: hashComposition(frame, layers, audio),
    layers,
    audio,
  };
}
