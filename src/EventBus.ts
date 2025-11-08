/**
 * Lightweight shared event bus for cache invalidation and domain events.
 */
import {EventEmitter} from "events";

/**
 * Listener signature for the {@link EventBus}.
 */
export type EventListener<T = unknown> = (payload: T) => void;

/**
 * Shared event bus for cache invalidation and other domain events.
 */
export class EventBus {
  private static instance: EventBus | null = null;

  private readonly emitter = new EventEmitter();

  /**
   * Returns the shared singleton bus.
   */
  static getDefault(): EventBus {
    if (!this.instance) {
      this.instance = new EventBus();
    }
    return this.instance;
  }

  /**
   * Subscribes to an event and returns a disposer.
   */
  on<T>(event: string, listener: EventListener<T>): () => void {
    this.emitter.on(event, listener as EventListener);
    return () => {
      this.emitter.off(event, listener as EventListener);
    };
  }

  /**
   * Subscribes to a single event emission.
   */
  once<T>(event: string, listener: EventListener<T>): void {
    this.emitter.once(event, listener as EventListener);
  }

  /**
   * Removes an existing listener.
   */
  off<T>(event: string, listener: EventListener<T>): void {
    this.emitter.off(event, listener as EventListener);
  }

  /**
   * Emits an event to all listeners.
   */
  emit<T>(event: string, payload: T): void {
    this.emitter.emit(event, payload);
  }
}
