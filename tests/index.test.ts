import {describe, expect, it, vi} from "vitest";
import * as library from "#v7/index.js";
import {Cache} from "#v7/Cache.js";
import Configuration from "#v7/Configuration.js";
import ConfigurationBase from "#v7/ConfigurationBase.js";
import DatabasePool from "#v7/DatabasePool.js";
import {DatabaseRecord} from "#v7/DatabaseRecord.js";
import {EventBus} from "#v7/EventBus.js";
import {Logger} from "#v7/Logger.js";

vi.mock("memcached", () => ({
  default: vi.fn(),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(),
}));

describe("library entry point", () => {
  it("re-exports public modules", () => {
    expect(library.Cache).toBe(Cache);
    expect(library.Configuration).toBe(Configuration);
    expect(library.ConfigurationBase).toBe(ConfigurationBase);
    expect(library.DatabasePool).toBe(DatabasePool);
    expect(library.DatabaseRecord).toBe(DatabaseRecord);
    expect(library.EventBus).toBe(EventBus);
    expect(library.Logger).toBe(Logger);
  });
});
