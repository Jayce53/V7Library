import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Pool} from "mysql2/promise";
import Configuration from "#v7/Configuration.js";
import DatabasePool from "#v7/DatabasePool.js";

const poolMocks = vi.hoisted(() => {
  const created: Array<{
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  }> = [];
  const mock = vi.fn(() => {
    const pool = {
      query: vi.fn(),
      execute: vi.fn(),
    };
    created.push(pool);
    return pool;
  });
  return {created, mock};
});

vi.mock("mysql2/promise", () => ({
  createPool: poolMocks.mock,
}));

const getLatestPool = () => {
  const pool = poolMocks.created.at(-1);
  if (!pool) {
    throw new Error("Pool was not created");
  }
  return pool;
};

describe("DatabasePool", () => {
  beforeEach(() => {
    DatabasePool.setPool(null);
    poolMocks.created.length = 0;
    poolMocks.mock.mockClear();
    vi.clearAllMocks();
  });

  it("creates a shared pool from configuration", () => {
    const configSpy = vi.spyOn(Configuration, "getDatabaseConfig").mockReturnValue({
      host: "db.host",
      port: 3307,
      user: "db-user",
      password: "secret",
      database: "db",
      connectionLimit: 5,
    });

    const pool = DatabasePool.getPool();

    expect(poolMocks.mock).toHaveBeenCalledTimes(1);
    expect(poolMocks.mock).toHaveBeenCalledWith({
      host: "db.host",
      port: 3307,
      user: "db-user",
      password: "secret",
      database: "db",
      connectionLimit: 5,
      waitForConnections: true,
      queueLimit: 0,
    });
    expect(pool).toBe(getLatestPool());
    configSpy.mockRestore();
  });

  it("falls back to configured connection limit when undefined", () => {
    const configSpy = vi.spyOn(Configuration, "getDatabaseConfig").mockReturnValue({
      host: "localhost",
      port: 3306,
      user: "user",
      password: "",
      database: "db",
      connectionLimit: undefined,
    });

    DatabasePool.getPool();

    expect(poolMocks.mock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionLimit: Configuration.DB_CONNECTION_LIMIT,
      }),
    );
    configSpy.mockRestore();
  });

  it("reuses the same pool instance", () => {
    const configSpy = vi.spyOn(Configuration, "getDatabaseConfig").mockReturnValue({
      host: "localhost",
      port: 3306,
      user: "user",
      password: "",
      database: "db",
      connectionLimit: 3,
    });

    const first = DatabasePool.getPool();
    const second = DatabasePool.getPool();

    expect(first).toBe(second);
    expect(poolMocks.mock).toHaveBeenCalledTimes(1);
    configSpy.mockRestore();
  });

  it("allows injecting a custom pool", async () => {
    const customPool = {
      query: vi.fn().mockResolvedValue([["rows"], []]),
      execute: vi.fn().mockResolvedValue([{affectedRows: 1}]),
    };
    DatabasePool.setPool(customPool as unknown as Pool);

    const result = await DatabasePool.query<string[][]>("SELECT 1");

    expect(result).toEqual([["rows"], []]);
    expect(customPool.query).toHaveBeenCalledWith("SELECT 1", []);
  });

  it("executes statements and returns the result header", async () => {
    const pool = {
      query: vi.fn(),
      execute: vi.fn().mockResolvedValue([{insertId: 10}]),
    };
    DatabasePool.setPool(pool as unknown as Pool);

    const result = await DatabasePool.execute("INSERT", ["value"]);

    expect(pool.execute).toHaveBeenCalledWith("INSERT", ["value"]);
    expect(result).toEqual({insertId: 10});
  });

  it("fetches one row or null", async () => {
    const pool = {
      query: vi.fn(),
      execute: vi.fn(),
    };
    DatabasePool.setPool(pool as unknown as Pool);

    pool.query.mockResolvedValueOnce([[{id: 1}], []]);
    const first = await DatabasePool.fetchOne<{id: number}>("SELECT", []);
    expect(first).toEqual({id: 1});

    pool.query.mockResolvedValueOnce([[], []]);
    const second = await DatabasePool.fetchOne<{id: number}>("SELECT", []);
    expect(second).toBeNull();
  });
});
