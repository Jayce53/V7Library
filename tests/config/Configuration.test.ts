import {describe, expect, it} from "vitest";

import Configuration from "#v7/Configuration.js";
import ConfigurationBase from "#v7/ConfigurationBase.js";

describe("ConfigurationBase", () => {
  it("composes database configuration from static properties", () => {
    class CustomConfiguration extends ConfigurationBase {
      static override readonly DB_HOST = "db.host";
      static override readonly DB_PORT = 3307;
      static override readonly DB_USER = "user";
      static override readonly DB_PASSWORD = "password";
      static override readonly DB_NAME = "database";
      static override readonly DB_CONNECTION_LIMIT = 15;
    }

    expect(CustomConfiguration.getDatabaseConfig()).toEqual({
      host: "db.host",
      port: 3307,
      user: "user",
      password: "password",
      database: "database",
      connectionLimit: 15,
    });
  });

  it("returns cloned memcached server definitions", () => {
    const servers = ConfigurationBase.getMemcachedServers();

    expect(servers).toEqual([{host: "127.0.0.1", port: 11211}]);

    servers[0].host = "changed";

    const again = ConfigurationBase.getMemcachedServers();
    expect(again).toEqual([{host: "127.0.0.1", port: 11211}]);
    expect(again[0]).not.toBe(servers[0]);
  });

  it("provides a default event namespace", () => {
    expect(ConfigurationBase.getEventNamespace()).toBe("fooderific");
  });
});
describe("Configuration", () => {
  it("inherits and exposes application specific values", () => {
    expect(Configuration.DB_HOST).toBe("localhost");
    expect(Configuration.DB_PORT).toBe(3306);
    expect(Configuration.DB_USER).toBe("fooderific");
    expect(Configuration.DB_PASSWORD).toBe("");
    expect(Configuration.DB_NAME).toBe("fooderific");
    expect(Configuration.DB_CONNECTION_LIMIT).toBe(20);
    expect(Configuration.CACHE_DOMAIN).toBe("fooderific.com");
    expect(Configuration.LOGGER_ADDRESS).toBeNull();
    expect(Configuration.LOGGER_PORT).toBeNull();
  });

  it("reuses base helpers with project specific configuration", () => {
    const dbConfig = Configuration.getDatabaseConfig();
    expect(dbConfig).toEqual({
      host: "localhost",
      port: 3306,
      user: "fooderific",
      password: "",
      database: "fooderific",
      connectionLimit: 20,
    });

    const servers = Configuration.getMemcachedServers();
    expect(servers).toEqual([{host: "127.0.0.1", port: 11211}]);
    expect(servers[0]).not.toBe(Configuration.MEMCACHED_SERVERS[0]);
  });
});
