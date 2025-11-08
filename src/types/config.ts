/**
 * Shared configuration type definitions used throughout the library.
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

export interface MemcachedServer {
  host: string;
  port: number;
}
