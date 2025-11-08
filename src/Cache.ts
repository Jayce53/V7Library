/**
 * Promise-based wrapper around Memcached with singleton management.
 */
import Memcached from "memcached";
import Configuration from "#v7/Configuration.js";
import type {MemcachedServer} from "#v7/types/config.js";

/**
 * Result returned from {@link Cache.gets} containing the cached value and CAS token.
 */
export interface GetsResult<T> {
  value: T;
  cas: string;
}

/**
 * Thin promise-based wrapper around the `memcached` client.
 */
export class Cache {
  private static client: Memcached | null = null;

  /**
   * Creates or returns the shared Memcached client.
   */
  static getClient(): Memcached {
    if (!this.client) {
      const servers = this.formatServers(Configuration.getMemcachedServers());
      this.client = new Memcached(servers);
    }

    return this.client;
  }

  /**
   * Allows tests to inject a mocked client or reset the singleton.
   */
  static setClient(client: Memcached | null): void {
    this.client = client;
  }

  /**
   * Indicates whether caching is enabled based on configured servers.
   */
  static isEnabled(): boolean {
    return Configuration.getMemcachedServers().length > 0;
  }

  /**
   * Reads a value from cache.
   * @param key Fully qualified cache key.
   */
  static async get<T>(key: string): Promise<T | undefined> {
    const client = this.getClient();
    return new Promise<T | undefined>((resolve, reject) => {
      client.get(key, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve((data ?? undefined) as T | undefined);
      });
    });
  }

  /**
   * Reads a value and CAS token pair from cache.
   */
  static async gets<T>(key: string): Promise<GetsResult<T> | null> {
    const client = this.getClient();
    return new Promise<GetsResult<T> | null>((resolve, reject) => {
      client.gets(key, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        if (!data) {
          resolve(null);
          return;
        }
        const {value, cas} = data as {value: T; cas: string};
        resolve({value, cas});
      });
    });
  }

  /**
   * Writes a value to cache with the given TTL.
   */
  static async set<T>(key: string, value: T, lifetimeSeconds: number): Promise<void> {
    const client = this.getClient();
    await new Promise<void>((resolve, reject) => {
      client.set(key, value, lifetimeSeconds, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Writes a value only if the key does not already exist.
   */
  static async add<T>(key: string, value: T, lifetimeSeconds: number): Promise<boolean> {
    const client = this.getClient();
    return new Promise<boolean>((resolve, reject) => {
      client.add(key, value, lifetimeSeconds, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Performs a compare-and-set update.
   * @param cas CAS token returned from {@link Cache.gets}.
   */
  static async cas<T>(key: string, value: T, cas: string, lifetimeSeconds: number): Promise<boolean> {
    const client = this.getClient();
    return new Promise<boolean>((resolve, reject) => {
      client.cas(key, value, cas, lifetimeSeconds, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Removes a value from cache.
   */
  static async del(key: string): Promise<void> {
    const client = this.getClient();
    await new Promise<void>((resolve, reject) => {
      client.del(key, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Flushes all entries from the connected Memcached cluster.
   */
  static async flush(): Promise<void> {
    const client = this.getClient();
    await new Promise<void>((resolve, reject) => {
      client.flush((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Formats Memcached host definitions for the client.
   */
  private static formatServers(servers: MemcachedServer[]): string[] {
    return servers.map((server) => `${server.host}:${server.port}`);
  }
}
