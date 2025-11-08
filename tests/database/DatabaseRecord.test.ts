/* eslint-disable max-classes-per-file */
import type Memcached from "memcached";
import type {Pool, ResultSetHeader, RowDataPacket} from "mysql2/promise";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Cache} from "#v7/Cache.js";
import {DatabaseRecord} from "#v7/DatabaseRecord.js";
import DatabasePool from "#v7/DatabasePool.js";
import {EventBus} from "#v7/EventBus.js";
import type {DatabaseRecordOptions, KeyValues, RecordPayload} from "#v7/types/database.js";

const CACHE_KEY = "V4fooderific.test_records.id.1";

vi.mock("memcached", () => {
  class MockMemcached {
    // The real client isn't used in these tests because we inject FakeMemcached.
    constructor() {}
    get(): void {}
    gets(): void {}
    set(): void {}
    add(): void {}
    cas(): void {}
    del(): void {}
    flush(): void {}
  }

  return {default: MockMemcached};
});

vi.mock("mysql2/promise", () => ({
  createPool: () => {
    throw new Error("createPool should not be called in tests");
  },
}));

const resolveLater = <T>(callback: (err: Error | null, data?: T) => void, data?: T, delay = 0): void => {
  setTimeout(() => callback(null, data), delay);
};

class FakeMemcached {
  private store = new Map<string, {value: unknown; cas: number; expiresAt: number | null}>();

  private casSequence = 1;

  private getEntry(key: string): {value: unknown; cas: number; expiresAt: number | null} | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  get<T>(key: string, callback: (err: Error | null, data: T | undefined) => void): void {
    const entry = this.getEntry(key);
    resolveLater(callback as (err: Error | null, data?: T) => void, (entry?.value ?? undefined) as T | undefined);
  }

  gets<T>(key: string, callback: (err: Error | null, data?: {value: T; cas: string}) => void): void {
    const entry = this.getEntry(key);
    if (!entry) {
      resolveLater(callback, undefined);
      return;
    }
    resolveLater(callback, {value: entry.value as T, cas: String(entry.cas)});
  }

  set<T>(key: string, value: T, lifetime: number, callback: (err: Error | null, result?: boolean) => void): void {
    const expiresAt = lifetime > 0 ? Date.now() + lifetime * 1000 : null;
    this.store.set(key, {value, cas: this.casSequence++, expiresAt});
    resolveLater(callback, true);
  }

  add<T>(key: string, value: T, lifetime: number, callback: (err: Error | null, result?: boolean) => void): void {
    const current = this.getEntry(key);
    if (current) {
      resolveLater(callback, false);
      return;
    }
    this.set(key, value, lifetime, callback);
  }

  cas<T>(
    key: string,
    value: T,
    cas: string | number,
    lifetime: number,
    callback: (err: Error | null, result?: boolean) => void,
  ): void {
    const entry = this.getEntry(key);
    if (!entry || String(entry.cas) !== String(cas)) {
      resolveLater(callback, false);
      return;
    }
    const expiresAt = lifetime > 0 ? Date.now() + lifetime * 1000 : null;
    this.store.set(key, {value, cas: this.casSequence++, expiresAt});
    resolveLater(callback, true);
  }

  del(key: string, callback: (err: Error | null, result?: boolean) => void): void {
    this.store.delete(key);
    resolveLater(callback, true);
  }

  flush(callback: (err: Error | null, result?: boolean) => void): void {
    this.store.clear();
    resolveLater(callback, true);
  }

  peek<T>(key: string): T | undefined {
    const entry = this.getEntry(key);
    return entry?.value as T | undefined;
  }
}

interface TestRecordRow {
  id: number;
  name: string;
  uppercaseName?: string;
  note?: string;
  extraTableRead?: boolean;
  cacheTimestamp?: number;
  cacheExpires?: number;
}

class FakePool {
  records = new Map<number, {id: number; name: string}>();

  extras = new Map<number, {record_id: number; note: string}>();

  queryLog: Array<{sql: string; params: unknown[]}> = [];

  executeLog: Array<{sql: string; params: unknown[]}> = [];

  async query<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown[]]> {
    this.queryLog.push({sql, params: params ?? []});

    if (sql.startsWith("SHOW COLUMNS FROM test_extra")) {
      const rows = [
        {Field: "record_id", Default: null, Type: "int"},
        {Field: "note", Default: "", Type: "varchar(255)"},
      ] as RowDataPacket[];
      return [rows as T, []];
    }

    if (sql.includes("FROM test_records")) {
      const id = params?.[0] as number;
      const record = this.records.get(id);
      if (!record) {
        return [[] as RowDataPacket[] as T, []];
      }
      const row = {
        ...record,
        uppercaseName: record.name.toUpperCase(),
      } as RowDataPacket;
      const typedRow = [row as RowDataPacket] as RowDataPacket[];
      return [typedRow as T, []];
    }

    if (sql.includes("FROM test_extra")) {
      const id = params?.[0] as number;
      const extra = this.extras.get(id);
      if (!extra) {
        return [[] as RowDataPacket[] as T, []];
      }
      const row = {...extra} as RowDataPacket;
      const typedRow = [row as RowDataPacket] as RowDataPacket[];
      return [typedRow as T, []];
    }

    throw new Error(`Unhandled query: ${sql}`);
  }

  async execute(sql: string, params?: unknown[]): Promise<[ResultSetHeader, unknown[]]> {
    this.executeLog.push({sql, params: params ?? []});

    if (sql.startsWith("UPDATE test_records")) {
      const id = params?.[params.length - 1] as number;
      const name = params?.[0] as string;
      const record = this.records.get(id);
      if (record) {
        record.name = name;
      }
      return [{affectedRows: 1, insertId: 0, warningStatus: 0} as ResultSetHeader, []];
    }

    if (sql.startsWith("UPDATE test_extra")) {
      const note = params?.[0] as string;
      const id = params?.[1] as number;
      const extra = this.extras.get(id);
      if (extra) {
        extra.note = note;
        return [{affectedRows: 1, insertId: 0, warningStatus: 0} as ResultSetHeader, []];
      }
      return [{affectedRows: 0, insertId: 0, warningStatus: 0} as ResultSetHeader, []];
    }

    if (sql.startsWith("INSERT INTO test_extra")) {
      const [, note] = params ?? [];
      const id = params?.[0] as number;
      this.extras.set(id, {record_id: id, note: note as string});
      return [{affectedRows: 1, insertId: id, warningStatus: 0} as ResultSetHeader, []];
    }

    if (sql.startsWith("DELETE FROM test_records")) {
      const id = params?.[0] as number;
      this.records.delete(id);
      return [{affectedRows: 1, insertId: 0, warningStatus: 0} as ResultSetHeader, []];
    }

    if (sql.startsWith("DELETE FROM test_extra")) {
      const id = params?.[0] as number;
      this.extras.delete(id);
      return [{affectedRows: 1, insertId: 0, warningStatus: 0} as ResultSetHeader, []];
    }

    return [{affectedRows: 0, insertId: 0, warningStatus: 0} as ResultSetHeader, []];
  }
}

class TestRecord extends DatabaseRecord<TestRecordRow> {
  private readonly initialKeyValues: KeyValues;

  static override tableName = "test_records";

  static override extraTableName = "test_extra";

  static override primaryKey = "id";

  static override extraPrimaryKey = "record_id";

  static override derivedFields = {
    uppercaseName: "name",
  };

  id!: number;

  name!: string;

  uppercaseName?: string;

  note?: string;

  constructor(keyValues: KeyValues, options?: DatabaseRecordOptions, eventBus?: EventBus) {
    super(keyValues, options, eventBus);
    this.initialKeyValues = {...keyValues};
  }

  protected override async computedFields(): Promise<string[]> {
    if (this.forceRead) {
      return ["UPPER(name) AS uppercaseName"];
    }
    return ["UPPER(name) AS uppercaseName"];
  }

  protected override noRecord(_keyValues: KeyValues): void {
    this.mergeRecord({
      id: -1,
      name: "",
      extraTableRead: true,
    });
  }

  async loadExtraForTests(): Promise<void> {
    await this.readExtraData();
  }
}

describe("DatabaseRecord", () => {
  let cache: FakeMemcached;
  let pool: FakePool;

  beforeEach(() => {
    cache = new FakeMemcached();
    pool = new FakePool();
    pool.records.set(1, {id: 1, name: "Alpha"});
    pool.extras.set(1, {record_id: 1, note: "First"});
    DatabasePool.setPool(pool as unknown as Pool);
    Cache.setClient(cache as unknown as Memcached);
    TestRecord.resetMetadataForTests();
  });

  afterEach(async () => {
    DatabasePool.setPool(null);
    Cache.setClient(null);
    cache.flush(() => {});
  });

  it("loads from database and populates cache on miss", async () => {
    const record = await TestRecord.load({id: 1});
    expect(record.wasInCache()).toBe(false);
    expect(record.name).toBe("Alpha");
    expect(record.uppercaseName).toBe("ALPHA");

    const firstSelects = pool.queryLog.filter((entry) => entry.sql.includes("FROM test_records"));
    expect(firstSelects).toHaveLength(1);

    const cachedValue = cache.peek<RecordPayload<TestRecordRow>>(CACHE_KEY);
    expect(cachedValue?.name).toBe("Alpha");

    const record2 = await TestRecord.load({id: 1});
    expect(record2.wasInCache()).toBe(true);
    const totalSelects = pool.queryLog.filter((entry) => entry.sql.includes("FROM test_records"));
    expect(totalSelects).toHaveLength(1);
  });

  it("updates database and cache", async () => {
    const record = await TestRecord.load({id: 1});
    await record.update({name: "Beta"});

    const updateCalls = pool.executeLog.filter((entry) => entry.sql.startsWith("UPDATE test_records"));
    expect(updateCalls).toHaveLength(1);
    expect(pool.records.get(1)?.name).toBe("Beta");

    const cachedValue = cache.peek<RecordPayload<TestRecordRow>>(CACHE_KEY);
    expect(cachedValue?.name).toBe("Beta");
  });

  it("reads extra table data on demand", async () => {
    const record = await TestRecord.load({id: 1});
    await record.loadExtraForTests();
    expect(record.note).toBe("First");
  });

  it("invalidates cache on delete with timeout marker", async () => {
    const record = await TestRecord.load({id: 1});
    await record.delete(5);
    const cachedValue = cache.peek<unknown>(CACHE_KEY);
    expect(cachedValue).toBe("__DATABASE_RECORD_DELETED__");
    expect(pool.records.has(1)).toBe(false);
  });

  it("emits events when enabled", async () => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.on("update", () => events.push("update"));
    const record = await TestRecord.load({id: 1}, {}, bus);
    await record.update({name: "Gamma"});
    expect(events).toContain("update");
  });
});
