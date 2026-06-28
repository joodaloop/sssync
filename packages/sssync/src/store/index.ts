import type { RowOf, TableName, Tables } from '../schema/infer'
import type {
  ClientDatabaseSchema,
  TableSchema,
} from '../schema/table-schema'
import type { InsertMutation, Mutation } from '../mutators/types'
import { primaryKeyFor } from '../shared'

/**
 * An INSERT mutation for any table in the schema. Distributes over every table
 * name so that once `table` is fixed, `data` is constrained to that table's row.
 */
export type Insert<S extends ClientDatabaseSchema> =
  TableName<S> extends infer Name
    ? Name extends TableName<S>
      ? InsertMutation<Name, Tables<S>[Name]>
      : never
    : never

/**
 * The Map key for a row, encoded from the schema's primary-key values.
 */
export type RowKeyOf<T extends TableSchema> = string

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

  constructor(private readonly schema: S) {
    this.tables = Object.fromEntries(
      Object.keys(schema.tables).map(name => [name, new Map()]),
    ) as { [Name in TableName<S>]: TableStore<Tables<S>[Name]> }
  }

  // Applies a batch of mutations in order. INSERT replaces the row at its key,
  // UPDATE merges changes into the existing row (no-op if absent), and DELETE
  // removes it. `isFromMutator` marks whether this batch comes from a local
  // mutator (an optimistic write) rather than the server.
  store(mutations: readonly Mutation<S>[], isFromMutator: boolean) {
    for (const mutation of mutations) {
      const table = this.tables[mutation.table as TableName<S>] as Map<
        unknown,
        RowOf<TableSchema>
      >
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
          table.delete(this.keyFor(mutation.table, mutation.id))
          break
        }
      }
    }
  }

  // Applies a batch of INSERTs, but only fills in rows that are currently
  // absent: an insert is skipped when a non-null row already exists at its key.
  // Used to seed the store without clobbering existing (e.g. locally mutated)
  // rows.
  addIfNotExist(inserts: readonly Insert<S>[]) {
    for (const insert of inserts) {
      const table = this.tables[insert.table as TableName<S>] as Map<
        unknown,
        RowOf<TableSchema>
      >
      if (!table) {
        throw new Error(`Unknown table "${insert.table}"`)
      }

      const key = this.keyFor(insert.table, insert.data)
      if (table.get(key) == null) {
        table.set(key, insert.data)
      }
    }
  }

  // Derives the Map key from a row or id object in primary-key order.
  private keyFor(tableName: string, record: Record<string, unknown>): unknown {
    return primaryKeyFor(this.schema.tables[tableName], record)
  }
}
