import type { EventMap } from './types';

type Listener<T> = (payload: T) => void;

/**
 * Typed pub/sub event bus.
 * All inter-system communication goes through here.
 */
export class EventBus {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    const key = event as string;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    const set = this.listeners.get(key)!;
    const fn = listener as Listener<unknown>;
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  /** Emit an event synchronously to all subscribers. */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event as string);
    if (!set) return;
    const fns = [...set];
    for (const fn of fns) {
      fn(payload);
    }
  }

  /** Remove all listeners (used on teardown). */
  clear(): void {
    this.listeners.clear();
  }
}
