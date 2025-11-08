import {beforeEach, describe, expect, it, vi} from "vitest";
import type Memcached from "memcached";
import Configuration from "#v7/Configuration.js";
import {Cache} from "#v7/Cache.js";

const memcachedMocks = vi.hoisted(() => {
  const instances: Array<Record<string, unknown>> = [];
  const factory = () => ({
    get: vi.fn(),
    gets: vi.fn(),
    set: vi.fn(),
    add: vi.fn(),
    cas: vi.fn(),
    del: vi.fn(),
    flush: vi.fn(),
  });
  type MockedClient = ReturnType<typeof factory> & {servers?: string[]};
  const mock = vi.fn((servers: string[]) => {
    const client: MockedClient = factory();
    client.servers = servers;
    instances.push(client);
    return client;
  });
  return {instances, factory, mock};
});

vi.mock("memcached", () => ({
  default: memcachedMocks.mock,
}));

const createMemcachedClient = () => memcachedMocks.factory();

const resetMocks = () => {
  Cache.setClient(null);
  memcachedMocks.mock.mockClear();
  memcachedMocks.instances.length = 0;
};

describe("Cache", () => {
  beforeEach(() => {
    resetMocks();
    vi.restoreAllMocks();
  });

  it("creates a memcached client using formatted configuration servers", () => {
    vi.spyOn(Configuration, "getMemcachedServers").mockReturnValue([
      {host: "10.0.0.1", port: 11211},
      {host: "10.0.0.2", port: 11212},
    ]);

    const client = Cache.getClient();

    expect(memcachedMocks.mock).toHaveBeenCalledTimes(1);
    expect(memcachedMocks.mock).toHaveBeenCalledWith(["10.0.0.1:11211", "10.0.0.2:11212"]);
    expect(client).toBe(memcachedMocks.instances[0]);
  });

  it("reuses the existing memcached client", () => {
    vi.spyOn(Configuration, "getMemcachedServers").mockReturnValue([
      {host: "127.0.0.1", port: 11211},
    ]);

    const first = Cache.getClient();
    const second = Cache.getClient();

    expect(first).toBe(second);
    expect(memcachedMocks.mock).toHaveBeenCalledTimes(1);
  });

  it("allows overriding the memcached client for tests", () => {
    const customClient = createMemcachedClient();
    Cache.setClient(customClient as unknown as Memcached);

    expect(Cache.getClient()).toBe(customClient);

    Cache.setClient(null);
    vi.spyOn(Configuration, "getMemcachedServers").mockReturnValue([
      {host: "127.0.0.1", port: 11211},
    ]);

    expect(Cache.getClient()).not.toBe(customClient);
  });

  it("reports whether cache is enabled", () => {
    const spy = vi.spyOn(Configuration, "getMemcachedServers");
    spy.mockReturnValueOnce([]);
    spy.mockReturnValueOnce([{host: "127.0.0.1", port: 11211}]);

    expect(Cache.isEnabled()).toBe(false);

    Cache.setClient(null);

    expect(Cache.isEnabled()).toBe(true);
  });

  it("retrieves values with get", async () => {
    const client = createMemcachedClient();
    client.get.mockImplementation((_key: string, cb: (err: Error | null, value: unknown) => void) => {
      cb(null, "cached-value");
    });
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.get<string>("cache:key")).resolves.toBe("cached-value");
    expect(client.get).toHaveBeenCalledWith("cache:key", expect.any(Function));
  });

  it("propagates errors from get", async () => {
    const client = createMemcachedClient();
    const error = new Error("boom");
    client.get.mockImplementation((_key, cb) => cb(error, undefined));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.get("cache:key")).rejects.toThrow(error);
  });

  it("retrieves values with gets including cas token", async () => {
    const client = createMemcachedClient();
    client.gets.mockImplementation((_key, cb) => cb(null, {value: {id: 1}, cas: "abc"}));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.gets<{id: number}>("cache:key")).resolves.toEqual({value: {id: 1}, cas: "abc"});
  });

  it("returns null when gets misses the cache", async () => {
    const client = createMemcachedClient();
    client.gets.mockImplementation((_key, cb) => cb(null, undefined));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.gets("cache:key")).resolves.toBeNull();
  });

  it("propagates errors from gets", async () => {
    const client = createMemcachedClient();
    const error = new Error("fail");
    client.gets.mockImplementation((_key, cb) => cb(error, undefined));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.gets("cache:key")).rejects.toThrow(error);
  });

  it("sets values", async () => {
    const client = createMemcachedClient();
    client.set.mockImplementation((_key, _value, _lifetime, cb) => cb(null));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.set("cache:key", "value", 10)).resolves.toBeUndefined();
    expect(client.set).toHaveBeenCalledWith("cache:key", "value", 10, expect.any(Function));
  });

  it("propagates errors when setting values", async () => {
    const client = createMemcachedClient();
    const error = new Error("set failed");
    client.set.mockImplementation((_key, _value, _lifetime, cb) => cb(error));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.set("cache:key", "value", 10)).rejects.toThrow(error);
  });

  it("adds values conditionally", async () => {
    const client = createMemcachedClient();
    client.add.mockImplementation((_key, _value, _lifetime, cb) => cb(null, true));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.add("cache:key", "value", 10)).resolves.toBe(true);
  });

  it("propagates errors from add", async () => {
    const client = createMemcachedClient();
    const error = new Error("add failed");
    client.add.mockImplementation((_key, _value, _lifetime, cb) => cb(error, false));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.add("cache:key", "value", 10)).rejects.toThrow(error);
  });

  it("updates values using cas", async () => {
    const client = createMemcachedClient();
    client.cas.mockImplementation((_key, _value, _cas, _lifetime, cb) => cb(null, true));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.cas("cache:key", "value", "token", 10)).resolves.toBe(true);
  });

  it("propagates errors from cas", async () => {
    const client = createMemcachedClient();
    const error = new Error("cas failed");
    client.cas.mockImplementation((_key, _value, _cas, _lifetime, cb) => cb(error, false));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.cas("cache:key", "value", "token", 10)).rejects.toThrow(error);
  });

  it("deletes values", async () => {
    const client = createMemcachedClient();
    client.del.mockImplementation((_key, cb) => cb(null));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.del("cache:key")).resolves.toBeUndefined();
    expect(client.del).toHaveBeenCalledWith("cache:key", expect.any(Function));
  });

  it("propagates errors from delete", async () => {
    const client = createMemcachedClient();
    const error = new Error("delete failed");
    client.del.mockImplementation((_key, cb) => cb(error));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.del("cache:key")).rejects.toThrow(error);
  });

  it("flushes the cache", async () => {
    const client = createMemcachedClient();
    client.flush.mockImplementation((cb) => cb(null));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.flush()).resolves.toBeUndefined();
    expect(client.flush).toHaveBeenCalledWith(expect.any(Function));
  });

  it("propagates errors from flush", async () => {
    const client = createMemcachedClient();
    const error = new Error("flush failed");
    client.flush.mockImplementation((cb) => cb(error));
    Cache.setClient(client as unknown as Memcached);

    await expect(Cache.flush()).rejects.toThrow(error);
  });
});
