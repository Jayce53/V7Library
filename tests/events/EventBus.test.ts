import {describe, expect, it, vi} from "vitest";

import {EventBus} from "#v7/EventBus.js";

describe("EventBus", () => {
  it("returns a shared singleton", () => {
    const first = EventBus.getDefault();
    const second = EventBus.getDefault();
    expect(first).toBe(second);
  });

  it("registers listeners and allows unsubscribing", () => {
    const bus = new EventBus();
    const listener = vi.fn();

    const unsubscribe = bus.on("invalidate", listener);

    bus.emit("invalidate", {id: 1});
    expect(listener).toHaveBeenCalledWith({id: 1});

    unsubscribe();
    bus.emit("invalidate", {id: 2});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("removes listeners via off", () => {
    const bus = new EventBus();
    const listener = vi.fn();

    bus.on("event", listener);
    bus.off("event", listener);

    bus.emit("event", "payload");
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports once listeners", () => {
    const bus = new EventBus();
    const listener = vi.fn();

    bus.once("event", listener);

    bus.emit("event", "payload1");
    bus.emit("event", "payload2");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("payload1");
  });
});
