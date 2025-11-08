import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {Logger} from "#v7/Logger.js";

describe("Logger", () => {
  let transport: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transport = vi.fn();
    Logger.setTransport(transport);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits structured entries with timestamps", () => {
    const fixed = new Date("2024-01-01T12:34:56.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixed);

    const logger = new Logger("order");
    logger.debug("created", {id: 10});

    expect(transport).toHaveBeenCalledTimes(1);
    const entry = transport.mock.calls[0][0];
    expect(entry).toMatchObject({
      level: "debug",
      context: "order",
      message: "created",
      metadata: {id: 10},
    });
    expect(entry.timestamp).toEqual(fixed);
  });

  it("logs with appropriate severity levels", () => {
    const logger = new Logger("session");

    logger.debug("debug-message");
    logger.info("info-message");
    logger.warn("warn-message");
    logger.error("error-message");

    expect(transport).toHaveBeenCalledTimes(4);

    const levels = transport.mock.calls.map(([entry]) => [
      entry.level,
      entry.message,
    ]);
    expect(levels).toEqual([
      ["debug", "debug-message"],
      ["info", "info-message"],
      ["warn", "warn-message"],
      ["error", "error-message"],
    ]);
  });

  it("omits metadata when not provided", () => {
    const logger = new Logger("context");
    logger.info("hello");

    const entry = transport.mock.calls[0][0];
    expect(entry.metadata).toBeUndefined();
  });
});
