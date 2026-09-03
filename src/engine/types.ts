/**
 * 엔진 전역 타입. docs/04_DATA_MODEL.md 와 1:1 대응.
 * 시간 값은 예외 없이 정수 프레임(Frame)이다. 초(sec)는 경계 변환에서만 쓴다.
 */

export type Frame = number;
export type Id = string;

export interface Fps {
  num: number;
  den: number;
}

export interface FrameRange {
  startFrame: Frame;
  /** exclusive */
  endFrame: Frame;
}

/* ────────────────────────────── 메타데이터 ────────────────────────────── */

export type SourceKind = 'synthetic' | 'file' | 'url';

export interface StreamInfo {
  durationFrames: Frame;
  fps: Fps;
  width: number;
  height: number;
  keyframeIntervalFrames: number;
  codec: string;
  container: string;
  sourceKind: SourceKind;
}

export interface TranscriptWord {
  w: string;
  startFrame: Frame;
  endFrame: Frame;
}

export interface TranscriptSegment extends FrameRange {
  id: Id;
  text: string;
  isSentenceEnd: boolean;
  speaker?: string;
  words?: TranscriptWord[];
  chapterId?: Id;
}

export interface Chapter extends FrameRange {
  id: Id;
  title: string;
  level: 1 | 2;
  parentId?: Id;
}

export interface SlideEvent {
  frame: Frame;
  slideId: Id;
  imageRef: string;
  title: string;
}

export interface MediaMetadata {
  mediaId: Id;
  title: string;
  breadcrumbs: string[];
  stream: StreamInfo;
  waveform: { samplesPerSecond: number; seed: number; peaks?: number[] };
  silences: Array<FrameRange & { levelDb: number }>;
  sceneChanges: Array<{ frame: Frame; score: number }>;
  transcript: { language: 'ko' | 'en'; segments: TranscriptSegment[] };
  slides: SlideEvent[];
  boardActivity: Array<FrameRange & { intensity: number }>;
  textbookRefs: Array<FrameRange & { page: number; ref: string }>;
  chapters: Chapter[];
  keywords: Array<{ term: string; frames: Frame[] }>;
}

/* ────────────────────────────── 자동 편집 ────────────────────────────── */

export type AutoEditPreset = 'silence-trim' | 'chapter-cut' | 'highlight' | 'from-selection';

export type BoundaryKind = 'scene' | 'sentence' | 'chapter' | 'silence';

export interface Boundary {
  frame: Frame;
  kind: BoundaryKind;
  weight: number;
}

export interface AutoEditRules {
  silenceThresholdDb: number;
  minSilenceFrames: Frame;
  paddingFrames: Frame;
  minSegmentFrames: Frame;
  maxSegmentFrames: Frame;
  snapToKeyframe: boolean;
  boundaryWeights: Record<BoundaryKind, number>;
  scoreWeights: {
    chapterStart: number;
    keyword: number;
    energy: number;
    slide: number;
    board: number;
  };
  targetDurationFrames?: Frame;
  selectedTranscriptIds?: Id[];
}

export interface Segment extends FrameRange {
  id: Id;
  chapterId?: Id;
  boundaryKinds: BoundaryKind[];
}

export type ScoreParts = Record<'chapterStart' | 'keyword' | 'energy' | 'slide' | 'board', number>;

export interface ScoredSegment extends Segment {
  score: number;
  reasons: string[];
  parts: ScoreParts;
}

export type RemovalReason = 'silence' | 'unselected' | 'low-score' | 'over-target';

export interface AutoEditReport {
  preset: AutoEditPreset;
  sourceDurationFrames: Frame;
  resultDurationFrames: Frame;
  savedFrames: Frame;
  removed: Array<FrameRange & { reason: RemovalReason }>;
  segments: ScoredSegment[];
  candidates: ScoredSegment[];
  warnings: string[];
}

export interface AutoEditResult {
  timeline: Timeline;
  report: AutoEditReport;
  rulesUsed: AutoEditRules;
  preset: AutoEditPreset;
}

/* ────────────────────────────── 타임라인 ────────────────────────────── */

export type TrackKind = 'video' | 'audio' | 'subtitle' | 'overlay';

export interface SourceRef {
  id: Id;
  mediaId: Id;
  kind: SourceKind;
  durationFrames: Frame;
  fps: Fps;
  label: string;
  objectUrl?: string;
}

export interface SubtitleStyle {
  fontSizePx: number;
  color: string;
  background: string;
  align: 'center' | 'left';
  position: 'bottom' | 'top';
}

export interface OverlayProps {
  kind: 'slide' | 'board' | 'textbook';
  imageRef: string;
  rect: { x: number; y: number; w: number; h: number };
  opacity: number;
}

export interface ClipMeta {
  segmentId?: Id;
  chapterId?: Id;
  score?: number;
  reasons?: string[];
}

export interface Clip {
  id: Id;
  trackId: Id;
  sourceId: Id;
  sourceInFrame: Frame;
  /** exclusive */
  sourceOutFrame: Frame;
  startFrame: Frame;
  enabled: boolean;
  label: string;
  linkedClipId?: Id;
  gain?: number;
  fadeInFrames?: Frame;
  fadeOutFrames?: Frame;
  subtitle?: { text: string; style: SubtitleStyle };
  overlay?: OverlayProps;
  meta?: ClipMeta;
}

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  clips: Clip[];
  muted: boolean;
  solo: boolean;
  locked: boolean;
  height?: number;
}

export interface Marker {
  id: Id;
  frame: Frame;
  label: string;
  color: string;
  kind: 'chapter' | 'user' | 'auto';
}

export interface Timeline {
  id: Id;
  name: string;
  mediaId: Id;
  fps: Fps;
  width: number;
  height: number;
  sources: Record<Id, SourceRef>;
  tracks: Track[];
  markers: Marker[];
  createdAt: string;
  updatedAt: string;
  version: 1;
}

/* ────────────────────────────── 재생 · 스트리밍 ────────────────────────────── */

export type PlaybackRate = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;

export interface PlaybackState {
  frame: Frame;
  isPlaying: boolean;
  rate: PlaybackRate;
  loop: FrameRange | null;
  inFrame: Frame | null;
  outFrame: Frame | null;
}

export type StreamState = 'idle' | 'loading' | 'ready' | 'buffering' | 'error';
export type Quality = 'auto' | '360p' | '720p' | '1080p';
export type EffectiveQuality = '360p' | '720p' | '1080p';

export interface StreamStatus {
  state: StreamState;
  quality: Quality;
  effectiveQuality: EffectiveQuality;
  bufferedRanges: FrameRange[];
  bufferAheadFrames: Frame;
  seekLatencyMs: number;
  bandwidthKbps: number;
  droppedFrames: number;
  keyframeIntervalFrames: number;
}

/* ────────────────────────────── 렌더 ────────────────────────────── */

export type CompLayer =
  | { kind: 'video'; sourceId: Id; sourceFrame: Frame; opacity: number }
  | {
      kind: 'overlay';
      imageRef: string;
      overlayKind: OverlayProps['kind'];
      rect: { x: number; y: number; w: number; h: number };
      opacity: number;
    }
  | { kind: 'subtitle'; text: string; style: SubtitleStyle }
  | { kind: 'gap' };

export interface CompAudio {
  clipId: Id;
  sourceId: Id;
  sourceFrame: Frame;
  gain: number;
}

export interface FrameComposition {
  frame: Frame;
  size: { w: number; h: number };
  hash: string;
  layers: CompLayer[];
  audio: CompAudio[];
}

export interface RenderOptions {
  manifest: boolean;
  vtt: boolean;
  srt: boolean;
  captureWebm: boolean;
  /** 렌더 시뮬레이션 속도(프레임/틱). 목업 전용 */
  framesPerTick?: number;
}

export interface RenderProgress {
  frame: Frame;
  total: Frame;
  fps: number;
  etaSec: number;
}

export interface RenderStats {
  durationFrames: Frame;
  clipCount: number;
  renderedAt: string;
  renderMs: number;
}

export interface RenderManifest {
  timeline: Timeline;
  chapters: Chapter[];
  stats: RenderStats;
  version: 1;
}

export interface RenderOutputs {
  manifestJson?: Blob;
  subtitlesVtt?: Blob;
  subtitlesSrt?: Blob;
  webm?: Blob;
}

export type RenderJobState = 'queued' | 'running' | 'done' | 'cancelled' | 'failed';

export interface RenderJob {
  id: Id;
  state: RenderJobState;
  progress: RenderProgress;
  outputs?: RenderOutputs;
  error?: EngineErrorShape;
}

/* ────────────────────────────── 오류 ────────────────────────────── */

export type EngineErrorCode =
  | 'MEDIA_LOAD_FAILED'
  | 'DECODE_ERROR'
  | 'SEEK_TIMEOUT'
  | 'ANALYSIS_FAILED'
  | 'INVALID_TIMELINE'
  | 'CLIP_OVERLAP'
  | 'OUT_OF_RANGE'
  | 'TRACK_LOCKED'
  | 'INVALID_ARGUMENT'
  | 'RENDER_ABORTED'
  | 'RENDER_FAILED'
  | 'AUDIO_CONTEXT_BLOCKED'
  | 'BRIDGE_PROTOCOL_ERROR'
  | 'UNKNOWN';

export type Severity = 'info' | 'warn' | 'error' | 'fatal';

export interface EngineErrorShape {
  code: EngineErrorCode;
  message: string;
  severity: Severity;
  recoverable: boolean;
  context?: Record<string, unknown>;
  at: string;
}

/* ────────────────────────────── 서비스 ────────────────────────────── */

export interface LectureSummary {
  id: Id;
  title: string;
  breadcrumbs: string[];
  durationFrames: Frame;
  fps: Fps;
  thumbnailRef: string;
  analyzed: boolean;
}

export type AnalysisStage =
  | 'probe'
  | 'audio'
  | 'scene'
  | 'transcript'
  | 'slides'
  | 'board'
  | 'chapters';

export interface AnalysisProgress {
  stage: AnalysisStage;
  stageIndex: number;
  stageCount: number;
  pct: number;
}
