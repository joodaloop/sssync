import type { Schema } from "../../packages/zero-types/src/schema.ts";
import { MemorySource } from "../../packages/zql/src/ivm/memory-source.ts";
import type { Source } from "../../packages/zql/src/ivm/source.ts";
import type { CommitListener } from "../../packages/zql/src/query/query-delegate.ts";
import { QueryDelegateBase } from "../../packages/zql/src/query/query-delegate-base.ts";

export class MyZeroDelegate<TSchema extends Schema> extends QueryDelegateBase {
  readonly defaultQueryComplete = true;

  readonly #schema: TSchema;
  readonly #sources = new Map<string, MemorySource>();
  readonly #commitListeners = new Set<CommitListener>();

  constructor(schema: TSchema) {
    super();
    this.#schema = schema;
  }

  override onTransactionCommit(cb: CommitListener): () => void {
    this.#commitListeners.add(cb);
    return () => {
      this.#commitListeners.delete(cb);
    };
  }

  fireCommit(): void {
    for (const cb of this.#commitListeners) {
      cb();
    }
  }

  getSource(tableName: string): Source | undefined {
    return this.ensureSource(tableName);
  }

  ensureSource(tableName: string): MemorySource | undefined {
    const existing = this.#sources.get(tableName);
    if (existing) {
      return existing;
    }

    const table = this.#schema.tables[tableName];
    if (!table) {
      return undefined;
    }

    const source = new MemorySource(tableName, table.columns, table.primaryKey);
    this.#sources.set(tableName, source);
    return source;
  }

  requireSource(tableName: string): MemorySource {
    const source = this.ensureSource(tableName);
    if (!source) {
      throw new Error(`Unknown table: ${tableName}`);
    }
    return source;
  }
}
