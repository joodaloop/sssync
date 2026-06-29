import type { Mutation } from '../mutators/types'
import type { RowOf, TableName, Tables } from '../schema/infer'
import type { ClientDatabaseSchema, TableSchema } from '../schema/table-schema'
import { primaryKeyFor } from '../shared'

export type RowsByTable = Readonly<Record<string, readonly Record<string, unknown>[]>>

/**
 * The Map key for a row, encoded from the schema's primary-key values.
 */
export type RowKeyOf<_T extends TableSchema> = string

/** One in-memory table: rows keyed by their primary key. */
export type TableStore<T extends TableSchema> = Map<RowKeyOf<T>, RowOf<T>>

export type Stores<S extends ClientDatabaseSchema> = {
  readonly [Name in TableName<S>]: TableStore<Tables<S>[Name]>
}

// Holds a JavaScript Map per table and applies batches of INSERT/UPDATE/DELETE
// mutations to them.
export class Store<S extends ClientDatabaseSchema> {
  // One Map per table, keyed by the row's primary key.
  readonly tables: Stores<S>
  readonly deleted: Map<string, null> = new Map()

  constructor(private readonly schema: S) {
    this.tables = Object.fromEntries(Object.keys(schema.tables).map(name => [name, new Map()])) as {
      [Name in TableName<S>]: TableStore<Tables<S>[Name]>
    }
  }

  // Applies a batch of mutations in order. INSERT replaces the row at its key,
  // UPDATE merges changes into the existing row (no-op if absent), and DELETE
  // removes it. `_isFromMutator` marks whether this batch comes from a local
  // mutator (an optimistic write) rather than the server.
  store(mutations: readonly Mutation<S>[], _isFromMutator: boolean) {
    for (const mutation of mutations) {
      const table = this.tables[mutation.table as TableName<S>] as Map<string, RowOf<TableSchema>>
      if (!table) {
        throw new Error(`Unknown table "${mutation.table}"`)
      }

      switch (mutation.type) {
        case 'INSERT': {
          table.set(this.keyFor(mutation.table, mutation.data), mutation.data)
          break
        }
        case 'UPDATE': {
          const key = this.keyFor(mutation.table, mutation.id)
          const existing = table.get(key)
          if (existing) {
            table.set(key, { ...existing, ...mutation.changes })
          }
          break
        }
        case 'DELETE': {
          const key = this.keyFor(mutation.table, mutation.id)
          table.delete(key)
          this.deleted.set(key, null)
          break
        }
      }
    }
  }

  // Adds rows from a table-keyed response, but only fills in rows that are
  // currently absent. Used to seed the store without clobbering existing
  // (e.g. locally mutated) rows.
  addIfNotExist(rowsByTable: RowsByTable) {
    for (const [tableName, rows] of Object.entries(rowsByTable)) {
      const table = this.tables[tableName as TableName<S>] as Map<string, RowOf<TableSchema>>
      if (!table) {
        throw new Error(`Unknown table "${tableName}"`)
      }

      for (const row of rows) {
        const key = this.keyFor(tableName, row)
        if (table.get(key) === undefined || this.deleted.has(key)) {
          table.set(key, row)
        }
      }
    }
  }

  // Derives the Map key from a row or id object in primary-key order.
  private keyFor(tableName: string, record: Record<string, unknown>): string {
    return primaryKeyFor(this.schema.tables[tableName], record)
  }
}
