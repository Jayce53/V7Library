import {EventEmitter} from "events";

export type EventListener<T = unknown> = (payload: T) => void;

/**
 * Shared event bus for cache invalidation and other domain events.
 */
export class EventBus {
  private static instance: EventBus | null = null;

  private readonly emitter = new EventEmitter();

  static getDefault(): EventBus {
    if (!this.instance) {
      this.instance = new EventBus();
    }
    return this.instance;
  }

  on<T>(event: string, listener: EventListener<T>): () => void {
    this.emitter.on(event, listener as EventListener);
    return () => {
      this.emitter.off(event, listener as EventListener);
    };
  }

  once<T>(event: string, listener: EventListener<T>): void {
    this.emitter.once(event, listener as EventListener);
  }

  off<T>(event: string, listener: EventListener<T>): void {
    this.emitter.off(event, listener as EventListener);
  }

  emit<T>(event: string, payload: T): void {
    this.emitter.emit(event, payload);
  }
}
