import type {DatabaseConfig, MemcachedServer} from "#v7/types/config.js";

/**
 * Base configuration for the Fooderific libraries.
 *
 * Extend this class in your project to provide concrete values. The defaults
 * here reflect a single-node development environment so the code can run
 * without additional setup.
 */
export default abstract class ConfigurationBase {
  /**
   * Database hostname or IP.
   */
  static readonly DB_HOST: string = "localhost";

  /**
   * Database TCP port.
   */
  static readonly DB_PORT: number = 3306;

  /**
   * Database username.
   */
  static readonly DB_USER: string = "";

  /**
   * Database password.
   */
  static readonly DB_PASSWORD: string = "";

  /**
   * Default schema/database to use.
   */
  static readonly DB_NAME: string = "";

  /**
   * Maximum number of connections available in the pool. Override as needed.
   */
  static readonly DB_CONNECTION_LIMIT: number = 10;

  /**
   * Domain string used when composing cache keys.
   */
  static readonly CACHE_DOMAIN: string = "localhost";

  /**
   * Memcached cluster definition. Each entry is [host, port].
   */
  static readonly MEMCACHED_SERVERS: ReadonlyArray<MemcachedServer> = Object.freeze([{
    host: "127.0.0.1",
    port: 11211,
  }]);

  /**
   * Optional remote logger configuration. Leave unset to disable.
   */
  static readonly LOGGER_ADDRESS: string | null = null;
  static readonly LOGGER_PORT: number | null = null;

  /**
   * Returns the connection settings for mysql2.
   */
  static getDatabaseConfig(): DatabaseConfig {
    return {
      host: this.DB_HOST,
      port: this.DB_PORT,
      user: this.DB_USER,
      password: this.DB_PASSWORD,
      database: this.DB_NAME,
      connectionLimit: this.DB_CONNECTION_LIMIT,
    };
  }

  /**
   * Returns the list of Memcached servers to connect to.
   */
  static getMemcachedServers(): MemcachedServer[] {
    return this.MEMCACHED_SERVERS.map((server) => ({...server}));
  }

  /**
   * Provides an identifier for grouping emitted events. Subclasses may override.
   */
  static getEventNamespace(): string {
    return "fooderific";
  }
}
