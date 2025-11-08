import {beforeAll, afterAll, afterEach, describe, expect, it, vi} from "vitest";
import {GenericContainer} from "testcontainers";
import {MySqlContainer} from "@testcontainers/mysql";
import {createConnection} from "mysql2/promise";
import Configuration from "#v7/Configuration.js";
import DatabasePool from "#v7/DatabasePool.js";
import {Cache} from "#v7/Cache.js";
import type {RowDataPacket} from "mysql2/promise";

describe("integration: Cache", () => {
  const memcachedPort = 11211;
  let memcachedContainer: Awaited<ReturnType<GenericContainer["start"]>>;
  let memcachedSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeAll(async () => {
    memcachedContainer = await new GenericContainer("memcached:1.6-alpine")
      .withExposedPorts(memcachedPort)
      .start();

    const host = memcachedContainer.getHost();
    const port = memcachedContainer.getMappedPort(memcachedPort);
    memcachedSpy = vi.spyOn(Configuration, "getMemcachedServers").mockReturnValue([{host, port}]);
    Cache.setClient(null);
  }, 90_000);

  afterEach(async () => {
    await Cache.flush();
  });

  afterAll(async () => {
    Cache.setClient(null);
    memcachedSpy?.mockRestore();
    if (memcachedContainer) {
      await memcachedContainer.stop();
    }
  });

  it("stores and retrieves values via a live memcached server", async () => {
    const key = `integration:cache:${Date.now()}`;
    await Cache.set(key, {value: 42}, 30);

    await expect(Cache.get<{value: number}>(key)).resolves.toEqual({value: 42});
  });

  it("supports compare-and-set semantics", async () => {
    const key = `integration:cache:cas:${Date.now()}`;
    await Cache.set(key, "first", 30);

    const getsResult = await Cache.gets<string>(key);
    expect(getsResult).not.toBeNull();
    const success = await Cache.cas(key, "second", getsResult!.cas, 30);

    expect(success).toBe(true);
    await expect(Cache.get<string>(key)).resolves.toBe("second");
  });
});

describe("integration: DatabasePool", () => {
  let mysqlContainer: Awaited<ReturnType<MySqlContainer["start"]>>;
  let configSpy: ReturnType<typeof vi.spyOn> | null = null;
  let seedConnection: Awaited<ReturnType<typeof createConnection>>;

  interface UserRow extends RowDataPacket {
    id: number;
    name: string;
  }

  beforeAll(async () => {
    mysqlContainer = await new MySqlContainer("mysql:8.0").start();

    const host = mysqlContainer.getHost();
    const port = mysqlContainer.getPort();

    seedConnection = await createConnection({
      host,
      port,
      user: mysqlContainer.getUsername(),
      password: mysqlContainer.getUserPassword(),
      database: mysqlContainer.getDatabase(),
    });

    await seedConnection.execute(/* sql */ `
      CREATE TABLE users (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      )
    `);
    await seedConnection.execute("INSERT INTO users (name) VALUES (?), (?)", ["Alice", "Bob"]);

    configSpy = vi.spyOn(Configuration, "getDatabaseConfig").mockReturnValue({
      host,
      port,
      user: mysqlContainer.getUsername(),
      password: mysqlContainer.getUserPassword(),
      database: mysqlContainer.getDatabase(),
      connectionLimit: 5,
    });
    DatabasePool.setPool(null);
  }, 90_000);

  afterAll(async () => {
    if (seedConnection) {
      await seedConnection.end();
    }
    if (mysqlContainer) {
      await mysqlContainer.stop();
    }
    configSpy?.mockRestore();
    DatabasePool.setPool(null);
  });

  it("runs queries against a live MySQL instance", async () => {
    const [rows] = await DatabasePool.query<UserRow[]>(
      "SELECT id, name FROM users ORDER BY id ASC",
    );
    expect(rows.map((row) => row.name)).toEqual(["Alice", "Bob"]);
  });

  it("updates rows using execute helper", async () => {
    const result = await DatabasePool.execute(
      "UPDATE users SET name = ? WHERE id = ?",
      ["Carol", 1],
    );
    expect(result.affectedRows).toBe(1);

    const user = await DatabasePool.fetchOne<UserRow>(
      "SELECT id, name FROM users WHERE id = ?",
      [1],
    );

    expect(user?.name).toBe("Carol");
  });
});
