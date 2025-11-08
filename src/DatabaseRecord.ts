/**
 * Rich Active Record style abstraction around MySQL rows with Memcached backing.
 */
import type {ResultSetHeader, RowDataPacket} from "mysql2/promise";
import {Cache} from "#v7/Cache.js";
import Configuration from "#v7/Configuration.js";
import DatabasePool from "#v7/DatabasePool.js";
import {EventBus} from "#v7/EventBus.js";
import {Logger} from "#v7/Logger.js";
import {
  type ColumnValue,
  type DatabaseRecordOptions,
  type DependencyMap,
  type DerivedFieldMap,
  type KeyValues,
  type RecordPayload,
  type SqlExpression,
  type TableMetadata,
} from "#v7/types/database.js";

type DatabaseRecordConstructor<TRecord extends Record<string, any>, TInstance extends DatabaseRecord<TRecord>> = new(
  keyValues: KeyValues,
  options?: DatabaseRecordOptions,
  eventBus?: EventBus,
) => TInstance;

const DEFAULT_CACHE_EXPIRATION = 3600;
const EXTENDED_CACHE_EXPIRATION = 30 * 24 * 60 * 60;
const MAX_CAS_ATTEMPTS = 5;
const DELETED_SENTINEL = "__DATABASE_RECORD_DELETED__";

const BASE_EVENTS = new Set(["insert", "update", "delete"]);

export interface InsertOptions {
  /**
   * Prevents the "insert" event from firing if false.
   */
  emitEvent?: boolean;
  /**
   * Overrides the cache expiration for the new record.
   */
  cacheExpiration?: number;
}

/**
 * Base class encapsulating common CRUD, caching, and eventing logic for tables.
 *
 * Extend this class to model a specific table. Subclasses configure metadata such as
 * `tableName`, `primaryKey`, and `derivedFields`, then rely on the provided helpers
 * to load rows, hydrate related tables, update/delete, and keep Memcached in sync.
 *
 * The class coordinates MySQL access via {@link DatabasePool}, cache reads/writes via
 * {@link Cache}, and cache invalidation notifications using {@link EventBus}.
 */
export abstract class DatabaseRecord<TRecord extends Record<string, any>> {
  static readonly FORCE_READ = true;
  static readonly FORCERECACHE = true;
  static readonly NO_IMMEDIATE_RECACHE = false;
  static readonly NO_EVENT = true;

  protected static tableName: string;
  protected static extraTableName?: string;
  protected static primaryKey: string | string[];
  protected static extraPrimaryKey?: string;
  protected static derivedFields?: DerivedFieldMap;
  protected static dependencies?: DependencyMap;
  protected static metadata: TableMetadata | null;
  protected static events: ReadonlyArray<string> | Record<string, string> = [];

  protected readonly log: Logger;
  protected readonly eventBus: EventBus;

  protected readonly keyValues: KeyValues;
  protected readonly cacheKey: string;
  protected readonly keySQL: string;
  protected readonly keyParams: unknown[];
  protected readonly cacheExpiration: number;
  protected readonly forceRead: boolean;

  protected casToken: string | null = null;
  protected inCache = false;
  protected metadata: TableMetadata = {};
  protected extraTableDefaults: Record<string, unknown> | null = null;
  protected dependencies?: DependencyMap;
  protected eventsDisabled = false;

  protected record: RecordPayload<TRecord> | null = null;

  private static shouldClearMetadataBeforeFetch(): boolean {
    return false;
  }

  /**
   * Entry point to construct and hydrate a record.
   */
  /**
   * Loads (and optionally caches) a record for the provided key values.
   */
  static async load<TRecord extends Record<string, any>, TInstance extends DatabaseRecord<TRecord>>(
    this: DatabaseRecordConstructor<TRecord, TInstance>,
    keyValues: KeyValues,
    options: DatabaseRecordOptions = {},
    eventBus?: EventBus,
  ): Promise<TInstance> {
    const instance = new this(keyValues, options, eventBus);
    await instance.initialise();
    return instance as TInstance;
  }

  /**
   * Convenience helper to construct raw SQL expressions used in insert/update.
   */
  /**
    * Wraps a literal SQL fragment with parameter bindings for insert/update calls.
    */
  static literal(sql: string, params: unknown[] = []): SqlExpression {
    return {sql, params};
  }

  protected constructor(
    keyValues: KeyValues,
    options: DatabaseRecordOptions = {},
    eventBus: EventBus = EventBus.getDefault(),
  ) {
    DatabaseRecord.validateKeyValues(keyValues);

    const expiration = options.cacheExpiration ?? DEFAULT_CACHE_EXPIRATION;

    this.keyValues = keyValues;
    this.cacheExpiration = expiration === 0 ? EXTENDED_CACHE_EXPIRATION : expiration;
    this.forceRead = options.forceRead ?? false;
    this.eventBus = eventBus;
    this.log = new Logger(this.constructor.name);

    this.cacheKey = (this.constructor as typeof DatabaseRecord).makeCacheKey(keyValues);
    const {clause, params} = DatabaseRecord.buildKeyClause(keyValues);
    this.keySQL = clause;
    this.keyParams = params;
  }

  /**
   * Returns whether the record data was satisfied by cache.
   */
  wasInCache(): boolean {
    return this.inCache;
  }

  /**
   * Removes the record from cache.
   */
  async unCache(): Promise<void> {
    await this.invalidateCache();
  }

  /**
   * Returns a shallow copy of the current record payload.
   */
  getDataRecord(): RecordPayload<TRecord> | null {
    return this.record ? {...this.record} : null;
  }

  /**
   * Updates both the cache and the underlying tables.
   */
  async update(data: Partial<RecordPayload<TRecord>>): Promise<this> {
    await this.ensureRecordLoaded();

    const sanitized = this.sanitiseUpdatePayload(data);
    if (Object.keys(sanitized).length === 0) {
      return this;
    }

    await this.updateCache(sanitized);
    await this.persistUpdate(sanitized);
    this.fireEvent("update");
    this.fireFieldEvents(sanitized);

    return this;
  }

  /**
   * Deletes the record from the database and invalidates the cache.
   */
  async delete(timeoutSeconds = 0): Promise<void> {
    await this.ensureRecordLoaded();

    const tableName = this.getTableName();
    const sql = `DELETE FROM ${tableName} WHERE ${this.keySQL}`;
    await DatabasePool.execute(sql, this.keyParams);

    const extraTable = this.getExtraTableName();
    if (extraTable) {
      const extraPrimary = this.getExtraPrimaryKey();
      const primaryValue = this.getPrimaryKeyValue();
      const extraSql = `DELETE FROM ${extraTable} WHERE ${extraPrimary} = ?`;
      await DatabasePool.execute(extraSql, [primaryValue]);
    }

    this.fireEvent("delete");
    await this.invalidateCache(timeoutSeconds);
  }

  /**
   * Inserts a new record, caches it, and returns the hydrated instance.
   */
  /**
   * Inserts a new row (and optional extra row) returning the hydrated record.
   */
  static async insert<TRecord extends Record<string, any>, TInstance extends DatabaseRecord<TRecord>>(
    this: DatabaseRecordConstructor<TRecord, TInstance> & typeof DatabaseRecord,
    data: Record<string, ColumnValue>,
    options: InsertOptions = {},
  ): Promise<TInstance | null> {
    const tableName = this.getTableNameStatic();
    const extraTable = this.getExtraTableNameStatic();

    const {
      columns: baseColumns,
      values: baseValues,
      params: baseParams,
    } = this.buildInsertFragments(data, extraTable ? await this.getExtraFieldSet(await this.getMetadata()) : new Set());

    let result: ResultSetHeader;
    if (baseColumns.length > 0) {
      const placeholders = baseValues.join(", ");
      const sql = `INSERT INTO ${tableName} (${baseColumns.join(", ")}) VALUES (${placeholders})`;
      result = await DatabasePool.execute(sql, baseParams);
    } else {
      const sql = `INSERT INTO ${tableName} () VALUES ()`;
      result = await DatabasePool.execute(sql);
    }

    if (result.insertId === undefined) {
      return null;
    }

    const keyValues = this.buildKeyValuesFromInsert(data, result.insertId);
    const instance = await this.load(keyValues, {
      cacheExpiration: options.cacheExpiration,
      forceRead: true,
    });

    if (extraTable) {
      const extraPrimary = this.getExtraPrimaryKeyStatic();
      const extraPayload = this.extractExtraTableData(data);
      if (extraPayload.columns.length > 0) {
        const columns = [extraPrimary, ...extraPayload.columns];
        const placeholders = ["?"].concat(extraPayload.values).join(", ");
        const sql = `INSERT INTO ${extraTable} (${columns.join(", ")}) VALUES (${placeholders})`;
        const params = [instance.getPrimaryKeyValue(), ...extraPayload.params];
        await DatabasePool.execute(sql, params);
      }
    }

    if (options.emitEvent !== false) {
      instance.fireEvent("insert");
    }

    return instance as TInstance;
  }

  /**
   * Clears metadata cache for the subclass.
   */
  /**
   * Clears cached table metadata for all record types.
   */
  static async clearMetaCache(): Promise<void> {
    if (!Cache.isEnabled()) {
      return;
    }
    const metaCacheKey = this.makeMetaCacheKey();
    try {
      await Cache.del(metaCacheKey);
    } catch (error) {
      const log = new Logger(this.name);
      log.warn("Failed to clear metadata cache", {error, key: metaCacheKey});
    }
  }

  /**
   * Clears process-local metadata and dependency caches (primarily for tests).
   */
  /**
   * Resets cached metadata for deterministic tests.
   */
  static resetMetadataForTests(): void {
    this.metadata = null;
    this.dependencies = undefined;
  }

  /**
   * Determines if the record currently exists in cache.
   */
  /**
   * Checks whether a record exists in cache for the provided keys.
   */
  static async isInCache(keyValues: KeyValues): Promise<boolean> {
    if (!Cache.isEnabled()) {
      return false;
    }
    const cacheKey = this.makeCacheKey(keyValues);
    const cached = await Cache.get<RecordPayload<Record<string, unknown>>>(cacheKey);
    return cached !== undefined && cached !== null;
  }

  /**
   * Subclasses must provide behaviour when no record exists.
   */
  protected abstract noRecord(keyValues: KeyValues): Promise<void> | void;

  /**
   * Hook invoked when a record is successfully retrieved.
   */
  protected async foundRecord(): Promise<void> {
    this.wasInCache();
  }

  /**
   * Override to return computed column expressions included in SELECT queries.
   */
  protected async computedFields(): Promise<string[]> {
    return this.forceRead ? [] : [];
  }

  /**
   * Reads supplementary data from the extra table if defined.
   */
  protected async readExtraData(): Promise<void> {
    await this.ensureRecordLoaded();

    const extraTable = this.getExtraTableName();
    if (!extraTable || !this.record) {
      return;
    }

    if (this.record.extraTableRead) {
      return;
    }

    const extraPrimary = this.getExtraPrimaryKey();
    const primaryValue = this.getPrimaryKeyValue();
    const sql = `SELECT * FROM ${extraTable} WHERE ${extraPrimary} = ?`;
    const [rows] = await DatabasePool.query<RowDataPacket[]>(sql, [primaryValue]);

    let payload: Record<string, unknown>;
    if (rows.length === 0) {
      payload = this.extraTableDefaults ? {...this.extraTableDefaults} : {};
    } else {
      payload = {...(rows[0] as Record<string, unknown>)};
      delete payload[extraPrimary];
    }

    const update = {...payload, extraTableRead: true} as Partial<RecordPayload<TRecord>>;
    this.mergeRecord(update);
    await this.updateCache(update);
  }

  /**
   * Disables event emission.
   */
  disableEvents(): void {
    this.eventsDisabled = true;
  }

  /**
   * Re-enables event emission.
   */
  enableEvents(): void {
    this.eventsDisabled = false;
  }

  /**
   * Fires an event using the shared bus if the event is registered.
   */
  protected fireEvent(event: string): void {
    if (this.eventsDisabled) {
      return;
    }
    if (!this.isValidEvent(event)) {
      this.log.warn("Attempted to fire unregistered event", {
        event,
        record: this.cacheKey,
      });
      return;
    }
    this.eventBus.emit(event, this);
  }

  /**
   * Returns the age of the cached record in seconds.
   */
  cacheAge(): number {
    if (!this.record || !this.record.cacheTimestamp) {
      return 0;
    }
    return Math.floor(Date.now() / 1000) - this.record.cacheTimestamp;
  }

  protected static getTableNameStatic(): string {
    if (!this.tableName) {
      throw new Error("tableName must be defined in subclass");
    }
    return this.tableName;
  }

  protected static getExtraTableNameStatic(): string | null {
    return this.extraTableName ?? null;
  }

  protected static getExtraPrimaryKeyStatic(): string {
    return this.extraPrimaryKey ?? this.primaryKeyAsArray()[0];
  }

  protected static primaryKeyAsArray(): string[] {
    return Array.isArray(this.primaryKey) ? this.primaryKey : [this.primaryKey];
  }

  protected getTableName(): string {
    return (this.constructor as typeof DatabaseRecord).getTableNameStatic();
  }

  protected getExtraTableName(): string | null {
    return (this.constructor as typeof DatabaseRecord).getExtraTableNameStatic();
  }

  protected getExtraPrimaryKey(): string {
    return (this.constructor as typeof DatabaseRecord).getExtraPrimaryKeyStatic();
  }

  protected getPrimaryKeyFields(): string[] {
    return (this.constructor as typeof DatabaseRecord).primaryKeyAsArray();
  }

  protected getPrimaryKeyValue(): unknown {
    const fields = this.getPrimaryKeyFields();
    if (fields.length !== 1) {
      const err = "getPrimaryKeyValue only supports single primary keys";
      throw new Error(err);
    }
    const field = fields[0];
    if (!this.record) {
      throw new Error("Record is not loaded");
    }
    return (this.record as Record<string, unknown>)[field];
  }

  protected async ensureRecordLoaded(): Promise<void> {
    if (!this.record) {
      await this.initialise();
    }
  }

  protected mergeRecord(update: Partial<RecordPayload<TRecord>>): void {
    if (!this.record) {
      this.record = {} as RecordPayload<TRecord>;
    }
    Object.assign(this.record, update);
    this.applyRecordToInstance(update);
  }

  protected applyRecordToInstance(update: Partial<RecordPayload<TRecord>>): void {
    Object.assign(this as Record<string, unknown>, update);
  }

  protected clearFieldFromInstance(field: string): void {
    delete (this as Record<string, unknown>)[field];
  }

  protected async initialise(): Promise<void> {
    if (!this.forceRead) {
      await this.tryLoadFromCache();
    }

    const ctor = this.constructor as typeof DatabaseRecord;
    this.metadata = await ctor.getMetadata();

    if (ctor.derivedFields && this.metadata) {
      this.dependencies = await this.resolveDependencies(this.metadata);
    } else if (ctor.dependencies) {
      this.dependencies = ctor.dependencies;
    }

    if (ctor.getExtraTableNameStatic()) {
      const extraFields = await ctor.getExtraFields(this.metadata);
      this.extraTableDefaults = extraFields;
      this.metadata = {...(this.metadata ?? {}), extraTableFields: extraFields};
    }

    if (!this.record || this.forceRead) {
      await this.loadFromDatabase();
    }
  }

  private async tryLoadFromCache(): Promise<void> {
    if (!Cache.isEnabled()) {
      return;
    }
    try {
      const cached = await Cache.gets<unknown>(this.cacheKey);
      if (!cached) {
        return;
      }
      if (cached.value === DELETED_SENTINEL) {
        return;
      }
      if (typeof cached.value !== "object" || cached.value === null) {
        return;
      }
      const value = cached.value as RecordPayload<TRecord>;
      this.casToken = cached.cas;
      this.record = value;
      this.applyRecordToInstance(value);
      this.inCache = true;
    } catch (error) {
      this.log.warn("Failed to read from cache", {error, key: this.cacheKey});
    }
  }

  private async loadFromDatabase(): Promise<void> {
    const tableName = this.getTableName();
    const computed = await this.computedFields();
    const selectList = ["*", ...computed].join(", ");
    const sql = `SELECT ${selectList} FROM ${tableName} WHERE ${this.keySQL}`;
    const [rows] = await DatabasePool.query<RowDataPacket[]>(sql, this.keyParams);
    const row = rows[0] as RecordPayload<TRecord> | undefined;

    if (!row) {
      await this.noRecord(this.keyValues);
      return;
    }

    const payload = this.decorateRecord(row);
    if (this.getExtraTableName()) {
      payload.extraTableRead = false;
    }

    this.record = payload;
    this.applyRecordToInstance(payload);
    await this.foundRecord();
    await this.writeToCache(payload);
    this.inCache = false;
  }

  private decorateRecord(record: Record<string, unknown>): RecordPayload<TRecord> {
    const payload = {...(record as RecordPayload<TRecord>)};
    const timestamp = Math.floor(Date.now() / 1000);
    payload.cacheTimestamp = timestamp;
    payload.cacheExpires = this.cacheExpiration === 0 ? 0 : timestamp + this.cacheExpiration;
    return payload;
  }

  private async writeToCache(payload: RecordPayload<TRecord>): Promise<void> {
    if (!Cache.isEnabled()) {
      return;
    }
    try {
      if (this.forceRead) {
        await Cache.set(this.cacheKey, payload, this.cacheExpiration);
      } else {
        const stored = await Cache.add(this.cacheKey, payload, this.cacheExpiration);
        if (!stored) {
          this.log.debug("Cache add returned false - likely already stored", {
            key: this.cacheKey,
          });
        }
      }
      const fresh = await Cache.gets<unknown>(this.cacheKey);
      if (fresh && typeof fresh.value === "object" && fresh.value !== null) {
        this.casToken = fresh.cas;
        const value = fresh.value as RecordPayload<TRecord>;
        this.record = value;
        this.applyRecordToInstance(value);
      }
    } catch (error) {
      this.log.error("Failed to write to cache", {error, key: this.cacheKey});
    }
  }

  private async updateCache(update?: Partial<RecordPayload<TRecord>>): Promise<void> {
    if (!Cache.isEnabled()) {
      if (update) {
        this.mergeRecord(update);
      }
      return;
    }

    if (!this.casToken) {
      this.log.debug("No CAS token available; skipping cache update", {
        key: this.cacheKey,
      });
      if (update) {
        this.mergeRecord(update);
      }
      return;
    }

    const startingRecord = this.record ? {...this.record} : ({} as RecordPayload<TRecord>);
    await this.performCasUpdate(startingRecord, this.casToken, update, 1);
  }

  private async performCasUpdate(
    record: RecordPayload<TRecord>,
    casToken: string,
    update: Partial<RecordPayload<TRecord>> | undefined,
    attempt: number,
  ): Promise<void> {
    if (attempt > MAX_CAS_ATTEMPTS) {
      this.log.warn("Exceeded maximum CAS attempts", {key: this.cacheKey});
      return;
    }

    const candidate = update ? this.applyUpdateToRecord(record, update) : record;

    try {
      const success = await Cache.cas(this.cacheKey, candidate, casToken, this.cacheExpiration);
      if (success) {
        const refreshed = await Cache.gets<unknown>(this.cacheKey);
        if (refreshed && typeof refreshed.value === "object" && refreshed.value !== null) {
          this.casToken = refreshed.cas;
          const value = refreshed.value as RecordPayload<TRecord>;
          this.record = value;
          this.applyRecordToInstance(value);
        } else {
          this.record = candidate;
          this.applyRecordToInstance(candidate);
        }
        return;
      }

      const refreshed = await Cache.gets<unknown>(this.cacheKey);
      if (!refreshed || typeof refreshed.value !== "object" || refreshed.value === null) {
        this.log.error("Cache entry missing after CAS failure", {
          key: this.cacheKey,
        });
        return;
      }

      const refreshedRecord = refreshed.value as RecordPayload<TRecord>;
      this.record = refreshedRecord;
      this.applyRecordToInstance(refreshedRecord);
      await this.performCasUpdate(refreshedRecord, refreshed.cas, update, attempt + 1);
    } catch (error) {
      this.log.error("Error while performing CAS update", {
        error,
        key: this.cacheKey,
      });
    }
  }

  private applyUpdateToRecord(
    record: RecordPayload<TRecord>,
    update: Partial<RecordPayload<TRecord>>,
  ): RecordPayload<TRecord> {
    const next = {...record};
    Object.entries(update).forEach(([field, value]) => {
      if (value === null || value === undefined) {
        delete next[field as keyof RecordPayload<TRecord>];
        this.clearFieldFromInstance(field);
        return;
      }
      next[field as keyof RecordPayload<TRecord>] = value;
    });

    Object.keys(update).forEach((field) => {
      const dependent = this.dependencies?.[field];
      dependent?.forEach((depField) => {
        delete next[depField as keyof RecordPayload<TRecord>];
        this.clearFieldFromInstance(depField);
      });
    });

    return next;
  }

  private async persistUpdate(update: Partial<RecordPayload<TRecord>>): Promise<void> {
    const tableName = this.getTableName();
    const extraTable = this.getExtraTableName();
    const extraFields = this.extraTableDefaults ? new Set(Object.keys(this.extraTableDefaults)) : new Set<string>();

    const baseAssignments: string[] = [];
    const baseParams: unknown[] = [];
    const extraAssignments: string[] = [];
    const extraParams: unknown[] = [];

    Object.entries(update).forEach(([field, value]) => {
      if (field === "extraTableRead" || field === "cacheTimestamp" || field === "cacheExpires") {
        return;
      }

      const usesExtraTable = extraFields.has(field);
      const targetAssignments = usesExtraTable ? extraAssignments : baseAssignments;
      const targetParams = usesExtraTable ? extraParams : baseParams;
      this.appendAssignment(field, value as ColumnValue, targetAssignments, targetParams);
    });

    if (baseAssignments.length > 0) {
      const sql = `UPDATE ${tableName} SET ${baseAssignments.join(", ")} WHERE ${this.keySQL}`;
      await DatabasePool.execute(sql, [...baseParams, ...this.keyParams]);
    }

    if (extraTable && extraAssignments.length > 0) {
      const extraPrimary = this.getExtraPrimaryKey();
      const sql = `UPDATE ${extraTable} SET ${extraAssignments.join(", ")} WHERE ${extraPrimary} = ?`;
      const params = [...extraParams, this.getPrimaryKeyValue()];
      const result = await DatabasePool.execute(sql, params);
      if (result.affectedRows === 0) {
        const insertColumns = [extraPrimary].concat(extraAssignments.map((a) => a.split("=")[0].trim()));
        const placeholders = ["?"].concat(extraAssignments.map(() => "?")).join(", ");
        const insertSql = `INSERT INTO ${extraTable} (${insertColumns.join(", ")}) VALUES (${placeholders})`;
        const insertParams = [this.getPrimaryKeyValue(), ...extraParams];
        await DatabasePool.execute(insertSql, insertParams);
      }
    }
  }

  private async invalidateCache(timeoutSeconds = 0): Promise<void> {
    if (!Cache.isEnabled()) {
      return;
    }
    try {
      await Cache.del(this.cacheKey);
      if (timeoutSeconds > 0) {
        await Cache.add(this.cacheKey, DELETED_SENTINEL, timeoutSeconds);
      }
    } catch (error) {
      this.log.warn("Failed to invalidate cache", {
        error,
        key: this.cacheKey,
      });
    }
  }

  private static buildKeyClause(keyValues: KeyValues): {
    clause: string;
    params: unknown[];
  } {
    const fragments: string[] = [];
    const params: unknown[] = [];
    Object.entries(keyValues).forEach(([field, value]) => {
      fragments.push(`${field} = ?`);
      params.push(value);
    });
    return {clause: fragments.join(" AND "), params};
  }

  private static validateKeyValues(keyValues: KeyValues): void {
    if (!keyValues || Object.keys(keyValues).length === 0) {
      throw new Error("Key values must contain at least one field");
    }
  }

  private sanitiseUpdatePayload(payload: Partial<RecordPayload<TRecord>>): Partial<RecordPayload<TRecord>> {
    if (!this.record) {
      return payload;
    }
    const sanitized: Partial<RecordPayload<TRecord>> = {};
    Object.entries(payload).forEach(([field, value]) => {
      if (field === "extraTableRead" || field === "cacheTimestamp" || field === "cacheExpires") {
        return;
      }
      if (value !== undefined && value !== (this.record as Record<string, unknown>)[field]) {
        sanitized[field as keyof RecordPayload<TRecord>] = value as RecordPayload<TRecord>[typeof field];
      }
    });
    return sanitized;
  }

  private appendAssignment(field: string, value: ColumnValue, assignments: string[], params: unknown[]): void {
    const ctor = this.constructor as typeof DatabaseRecord;
    if (ctor.isSqlExpression(value)) {
      assignments.push(`${field} = ${value.sql}`);
      if (value.params) {
        params.push(...value.params);
      }
    } else {
      assignments.push(`${field} = ?`);
      params.push(value);
    }
  }

  private static isSqlExpression(value: ColumnValue): value is SqlExpression {
    return typeof value === "object" && value !== null && "sql" in value;
  }

  private fireFieldEvents(update: Partial<RecordPayload<TRecord>>): void {
    const ctor = this.constructor as typeof DatabaseRecord;
    if (!ctor.events || Array.isArray(ctor.events)) {
      return;
    }
    Object.entries(ctor.events).forEach(([field, event]) => {
      if (field in update) {
        this.fireEvent(event);
      }
    });
  }

  private isValidEvent(event: string): boolean {
    if (BASE_EVENTS.has(event)) {
      return true;
    }
    const ctor = this.constructor as typeof DatabaseRecord;
    if (Array.isArray(ctor.events)) {
      return ctor.events.includes(event);
    }
    return Object.values(ctor.events).includes(event);
  }

  private static async getMetadata(): Promise<TableMetadata> {
    if (this.metadata) {
      return this.metadata;
    }

    if (this.shouldClearMetadataBeforeFetch()) {
      await this.clearMetaCache();
    }

    let metadata: TableMetadata | undefined;
    if (Cache.isEnabled()) {
      metadata = await Cache.get<TableMetadata>(this.makeMetaCacheKey());
    }

    if (!metadata) {
      metadata = {};
      if (Cache.isEnabled()) {
        await Cache.add(this.makeMetaCacheKey(), metadata, 1800);
      }
    }

    this.metadata = metadata;
    return metadata;
  }

  private static async cacheMetadata(metadata: TableMetadata): Promise<void> {
    if (!Cache.isEnabled()) {
      return;
    }
    try {
      await Cache.set(this.makeMetaCacheKey(), metadata, 0);
    } catch (error) {
      const log = new Logger(this.name);
      log.warn("Failed to cache metadata", {error});
    }
  }

  private static async getExtraFields(existingMetadata?: TableMetadata): Promise<Record<string, unknown>> {
    const metadata = existingMetadata ?? (await this.getMetadata());
    if (metadata.extraTableFields) {
      return metadata.extraTableFields;
    }
    const extraTable = this.getExtraTableNameStatic();
    if (!extraTable) {
      const updatedMetadata = {...metadata, extraTableFields: {}};
      this.metadata = updatedMetadata;
      await this.cacheMetadata(updatedMetadata);
      return {};
    }

    const [rows] = await DatabasePool.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${extraTable}`);
    const extraTableFields: Record<string, unknown> = {};
    rows.forEach((row) => {
      const field = row.Field as string;
      let defaultValue = row.Default;
      if (defaultValue === null || defaultValue === undefined) {
        defaultValue = "";
      } else if (defaultValue === "CURRENT_TIMESTAMP") {
        defaultValue = 0;
      }
      extraTableFields[field] = defaultValue;
    });

    const updatedMetadata = {...metadata, extraTableFields};
    this.metadata = updatedMetadata;
    await this.cacheMetadata(updatedMetadata);
    return extraTableFields;
  }

  private static makeCacheKey(keyValues: KeyValues): string {
    const dbName = Configuration.getDatabaseConfig().database;
    const tableName = this.getTableNameStatic();
    const fragments = [`V4${dbName}.${tableName}`];
    Object.entries(keyValues).forEach(([field, value]) => {
      fragments.push(`${field.toLowerCase()}.${String(value).toLowerCase()}`);
    });
    return fragments.join(".");
  }

  private static makeMetaCacheKey(): string {
    const dbName = Configuration.getDatabaseConfig().database;
    const tableName = this.getTableNameStatic();
    return `V4${dbName}.${tableName}.metadata`;
  }

  private static async getExtraFieldSet(metadata?: TableMetadata): Promise<Set<string>> {
    const fields = await this.getExtraFields(metadata);
    return new Set(Object.keys(fields));
  }

  private static buildInsertFragments(
    data: Record<string, ColumnValue>,
    extraFields: Set<string>,
  ): {columns: string[]; values: string[]; params: unknown[]} {
    const columns: string[] = [];
    const values: string[] = [];
    const params: unknown[] = [];

    Object.entries(data).forEach(([field, value]) => {
      if (extraFields.has(field)) {
        return;
      }
      columns.push(field);
      if (typeof value === "object" && value !== null && "sql" in value) {
        values.push((value as SqlExpression).sql);
        if ((value as SqlExpression).params) {
          params.push(...(value as SqlExpression).params!);
        }
        return;
      }
      values.push("?");
      params.push(value);
    });

    return {columns, values, params};
  }

  private static buildKeyValuesFromInsert(data: Record<string, ColumnValue>, insertId: number): KeyValues {
    const keyValues: KeyValues = {};
    const keyFields = this.primaryKeyAsArray();
    keyFields.forEach((keyField) => {
      if (keyField in data) {
        const value = data[keyField];
        if (typeof value === "object" && value !== null && "sql" in value) {
          throw new Error(`Cannot derive primary key value from SQL expression for field ${keyField}`);
        }
        keyValues[keyField] = value as string | number | bigint;
      } else if (keyFields.length === 1) {
        keyValues[keyField] = insertId;
      } else {
        throw new Error(`Missing value for composite primary key field ${keyField}`);
      }
    });
    return keyValues;
  }

  private static extractExtraTableData(
    data: Record<string, ColumnValue>,
  ): {columns: string[]; values: string[]; params: unknown[]} {
    const metadata = this.metadata ?? {};
    const extraFields = metadata.extraTableFields ? Object.keys(metadata.extraTableFields) : [];
    const columns: string[] = [];
    const values: string[] = [];
    const params: unknown[] = [];

    extraFields.forEach((field) => {
      if (!(field in data)) {
        return;
      }
      columns.push(field);
      const value = data[field];
      if (typeof value === "object" && value !== null && "sql" in value) {
        values.push((value as SqlExpression).sql);
        if ((value as SqlExpression).params) {
          params.push(...(value as SqlExpression).params!);
        }
        return;
      }
      values.push("?");
      params.push(value);
    });

    return {columns, values, params};
  }

  private async resolveDependencies(metadata: TableMetadata): Promise<DependencyMap> {
    const ctor = this.constructor as typeof DatabaseRecord;
    if (ctor.dependencies && Object.keys(ctor.dependencies).length > 0) {
      return ctor.dependencies;
    }

    if (metadata.dependencies) {
      ctor.dependencies = metadata.dependencies;
      return metadata.dependencies;
    }

    if (!ctor.derivedFields) {
      return {};
    }

    const dependencies: DependencyMap = {};
    Object.entries(ctor.derivedFields).forEach(([field, parents]) => {
      const parentList = Array.isArray(parents) ? parents : [parents];
      parentList.forEach((parent) => {
        if (!dependencies[parent]) {
          dependencies[parent] = [];
        }
        dependencies[parent].push(field);
      });
    });

    const updatedMetadata = {...metadata, dependencies};
    this.metadata = updatedMetadata;
    ctor.metadata = updatedMetadata;
    ctor.dependencies = dependencies;
    await ctor.cacheMetadata(updatedMetadata);

    return dependencies;
  }
}
