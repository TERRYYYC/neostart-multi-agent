/**
 * Generic persistence layer for cat-cafe v1.
 * 通用持久化层。
 *
 * Provides a Store<T> interface and a JSON-file-based implementation.
 * The interface is deliberately narrow so callers never depend on file I/O
 * details, making future migration to SQLite/Postgres straightforward.
 * 提供 Store<T> 接口和基于 JSON 文件的实现。
 * 接口刻意简化，调用者不依赖文件 I/O 细节，方便未来迁移。
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Store interface / 存储接口
// ---------------------------------------------------------------------------

/**
 * Async CRUD interface for any entity with an `id` field.
 * 任何含 `id` 字段实体的异步 CRUD 接口。
 */
export interface Store<T extends { id: string }> {
  /** Return all records. / 返回所有记录。 */
  getAll(): Promise<T[]>;

  /** Return one record by id, or undefined. / 按 id 返回一条记录。 */
  getById(id: string): Promise<T | undefined>;

  /** Return records matching a predicate. / 返回匹配谓词的记录。 */
  findBy(predicate: (item: T) => boolean): Promise<T[]>;

  /** Persist a new record (must have unique id). / 持久化新记录。 */
  create(item: T): Promise<T>;

  /** Partially update an existing record. / 部分更新已有记录。 */
  update(id: string, patch: Partial<T>): Promise<T>;

  /** Remove a record by id. Returns true if it existed. / 按 id 删除。 */
  delete(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// JSON file implementation / JSON 文件实现
// ---------------------------------------------------------------------------

/**
 * Stores an array of T in a single JSON file.
 * 在单个 JSON 文件中存储 T 数组。
 *
 * - Reads into memory on first access, caches thereafter.
 * - Writes atomically (tmp → rename) on every mutation.
 * - Auto-creates the file with [] if missing.
 * - 首次访问时读入内存并缓存。
 * - 每次变更时原子写入（tmp → rename）。
 * - 文件不存在时自动创建为 []。
 */
export class JsonFileStore<T extends { id: string }> implements Store<T> {
  private cache: T[] | null = null;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  // -- reads ----------------------------------------------------------------

  async getAll(): Promise<T[]> {
    return [...(await this.load())];
  }

  async getById(id: string): Promise<T | undefined> {
    const data = await this.load();
    return data.find((item) => item.id === id);
  }

  async findBy(predicate: (item: T) => boolean): Promise<T[]> {
    const data = await this.load();
    return data.filter(predicate);
  }

  // -- writes ---------------------------------------------------------------

  async create(item: T): Promise<T> {
    const data = await this.load();
    const existing = data.find((i) => i.id === item.id);
    if (existing) {
      throw new Error(`Duplicate id: ${item.id}`);
    }
    data.push(item);
    await this.flush(data);
    return item;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const data = await this.load();
    const idx = data.findIndex((i) => i.id === id);
    if (idx === -1) {
      throw new Error(`Not found: ${id}`);
    }
    const updated = { ...data[idx], ...patch, id } as T; // id is immutable
    data[idx] = updated;
    await this.flush(data);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const data = await this.load();
    const idx = data.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    data.splice(idx, 1);
    await this.flush(data);
    return true;
  }

  // -- internals ------------------------------------------------------------

  private async load(): Promise<T[]> {
    if (this.cache !== null) return this.cache;

    if (!existsSync(this.filePath)) {
      await this.ensureDir();
      await writeFile(this.filePath, '[]', 'utf-8');
      this.cache = [];
      return this.cache;
    }

    const raw = await readFile(this.filePath, 'utf-8');
    this.cache = JSON.parse(raw) as T[];
    return this.cache;
  }

  /**
   * Atomic write: write to a temp file, then rename.
   * 原子写入：先写临时文件，再 rename。
   */
  private async flush(data: T[]): Promise<void> {
    this.cache = data;
    const tmp = this.filePath + '.tmp';
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmp, this.filePath);
  }

  private async ensureDir(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}
