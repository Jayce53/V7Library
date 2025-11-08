import {
  createPool,
  type FieldPacket,
  type Pool,
  type PoolOptions,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import Configuration from "#v7/Configuration.js";

/**
 * Shared MySQL connection pool.
 *
 * Wrapping mysql2's pool creation lets us centralise configuration and makes
 * the pool replaceable in unit tests.
 */
export default class DatabasePool {
  private static pool: Pool | null = null;

  /**
   * Lazily creates (or returns) the shared connection pool using configuration
   * values.
   */
  static getPool(): Pool {
    if (!this.pool) {
      const dbConfig = Configuration.getDatabaseConfig();
      const options: PoolOptions = {
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        connectionLimit: dbConfig.connectionLimit ?? Configuration.DB_CONNECTION_LIMIT,
        waitForConnections: true,
        queueLimit: 0,
      };

      this.pool = createPool(options);
    }

    return this.pool;
  }

  /**
   * Allows tests to inject a custom pool (or reset the singleton).
   */
  static setPool(pool: Pool | null): void {
    this.pool = pool;
  }

  static async query<T extends RowDataPacket[] | ResultSetHeader>(
    sql: string,
    params: unknown[] = [],
  ): Promise<[T, FieldPacket[]]> {
    const pool = this.getPool();
    return pool.query<T>(sql, params);
  }

  static async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<ResultSetHeader> {
    const pool = this.getPool();
    const [result] = await pool.execute<ResultSetHeader>(sql, params);
    return result;
  }

  static async fetchOne<T extends RowDataPacket>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const pool = this.getPool();
    const [rows] = await pool.query<T[]>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }
}
