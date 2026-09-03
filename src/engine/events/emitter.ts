/** 엔진 전용 최소 타입드 이벤트 에미터. DOM 비의존. */
export class Emitter<TEvents extends Record<string, unknown>> {
  private map = new Map<keyof TEvents, Set<(p: never) => void>>();

  on<K extends keyof TEvents>(type: K, fn: (payload: TEvents[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn as (p: never) => void);
    return () => {
      set!.delete(fn as (p: never) => void);
    };
  }

  emit<K extends keyof TEvents>(type: K, payload: TEvents[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) (fn as (p: TEvents[K]) => void)(payload);
  }

  clear(): void {
    this.map.clear();
  }
}
