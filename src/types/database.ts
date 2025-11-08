export type KeyValues = Record<string, string | number | bigint>;

export interface DatabaseRecordOptions {
  cacheExpiration?: number;
  forceRead?: boolean;
}

export interface DerivedFieldMap {
  [field: string]: string | string[];
}

export interface DependencyMap {
  [parentField: string]: string[];
}

export interface TableMetadata {
  dependencies?: DependencyMap;
  extraTableFields?: Record<string, unknown>;
  setFieldValues?: Record<string, string[]>;
}

export interface GetsMetadata<T> {
  value: T;
  cas: string;
}

export interface CacheMetadata {
  cacheTimestamp: number;
  cacheExpires: number;
  extraTableRead?: boolean;
}

export type RecordPayload<T extends object> = T & Partial<CacheMetadata>;

export interface SqlExpression {
  sql: string;
  params?: unknown[];
}

export type ColumnValue = unknown | SqlExpression;
