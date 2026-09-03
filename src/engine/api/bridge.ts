import { EngineError } from '../errors';
import { Emitter } from '../events/emitter';
import type { EngineErrorShape, Frame, Id, RenderManifest } from '../types';

export const BRIDGE_CHANNEL = 'sl-editor';
export const BRIDGE_VERSION = 1;

export type PlayerToEditor =
  | { type: 'open'; payload: { lectureId: Id; initialFrame?: Frame } }
  | { type: 'seek'; payload: { frame?: Frame; sec?: number } }
  | { type: 'select-transcript'; payload: { segmentIds: Id[] } }
  | { type: 'request-export'; payload: { opts?: Record<string, unknown> } };

export type EditorToPlayer =
  | { type: 'ready'; payload: { version: number } }
  | { type: 'frame'; payload: { frame: Frame; sec: number } }
  | { type: 'timeline-changed'; payload: { durationFrames: Frame; clipCount: number } }
  | { type: 'export:progress'; payload: { frame: Frame; total: Frame } }
  | { type: 'export:done'; payload: { manifest: RenderManifest | null; vtt: string | null } }
  | { type: 'export:error'; payload: EngineErrorShape }
  | { type: 'error'; payload: EngineErrorShape };

export interface BridgeMessage {
  channel: typeof BRIDGE_CHANNEL;
  v: number;
  type: string;
  payload: unknown;
  requestId?: string;
}

export interface PostTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface MessageBus {
  addEventListener(type: 'message', fn: (e: { data: unknown; origin: string }) => void): void;
  removeEventListener(type: 'message', fn: (e: { data: unknown; origin: string }) => void): void;
}

type InboundEvents = { [K in PlayerToEditor['type']]: Extract<PlayerToEditor, { type: K }>['payload'] };

/**
 * 자사 플레이어 임베드용 postMessage 브리지.
 * 편집기가 iframe 안에서 동작한다고 가정하고, 형식이 어긋난 메시지는 조용히 버린다.
 */
export class PlayerBridge {
  readonly events = new Emitter<InboundEvents & Record<string, unknown>>();

  private target: PostTarget | null = null;
  private targetOrigin = '*';
  private bus: MessageBus | null = null;
  private handler = (e: { data: unknown; origin: string }) => this.receive(e);

  constructor(private onError?: (e: EngineError) => void) {}

  connect(target: PostTarget, bus: MessageBus, targetOrigin = '*'): void {
    this.target = target;
    this.bus = bus;
    this.targetOrigin = targetOrigin;
    bus.addEventListener('message', this.handler);
  }

  disconnect(): void {
    this.bus?.removeEventListener('message', this.handler);
    this.target = null;
    this.bus = null;
    this.events.clear();
  }

  send<T extends EditorToPlayer>(type: T['type'], payload: T['payload']): void {
    if (!this.target) return;
    const msg: BridgeMessage = { channel: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type, payload };
    this.target.postMessage(msg, this.targetOrigin);
  }

  private receive(e: { data: unknown; origin: string }): void {
    const data = e.data as Partial<BridgeMessage> | null;
    if (!data || typeof data !== 'object' || data.channel !== BRIDGE_CHANNEL) return;
    if (data.v !== BRIDGE_VERSION) {
      this.onError?.(
        new EngineError('BRIDGE_PROTOCOL_ERROR', `지원하지 않는 브리지 버전입니다: ${String(data.v)}`, {
          context: { got: data.v, expected: BRIDGE_VERSION },
        }),
      );
      return;
    }
    if (typeof data.type !== 'string') {
      this.onError?.(new EngineError('BRIDGE_PROTOCOL_ERROR', '메시지 타입이 없습니다.'));
      return;
    }
    this.events.emit(data.type, data.payload as never);
  }
}

export interface LmsPublishInput {
  lectureId: Id;
  manifest: RenderManifest;
  title: string;
  kind: 'highlight' | 'chapter-clips' | 'trimmed';
}

export interface LmsEvent {
  verb: 'opened' | 'edited' | 'exported' | 'published';
  lectureId: Id;
  at: string;
  detail?: Record<string, unknown>;
}

export interface LmsBridge {
  publish(input: LmsPublishInput): Promise<{ materialId: Id }>;
  reportEvent(ev: LmsEvent): Promise<void>;
  getLog(): LmsEvent[];
}
