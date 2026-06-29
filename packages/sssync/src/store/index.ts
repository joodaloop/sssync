import type { Mutation } from '../mutators/types'
import type { IdInputOf, RowOf, TableName, Tables } from '../schema/infer'
import type { ClientDatabaseSchema, TableSchema } from '../schema/table-schema'
import { primaryKeyFor } from '../shared'

export type RowsByTable = Readonly<Record<string, readonly Record<string, unknown>[]>>
export type StoreRow = Readonly<Record<string, unknown>>
export type StoreRowPatch = Readonly<Record<string, unknown>>

export type StoreRowChange =
  | {
      readonly type: 'insert'
      readonly table: string
      readonly key: string
      readonly row: StoreRow
    }
  | {
      readonly type: 'update'
      readonly table: string
      readonly key: string
      readonly changes: StoreRowPatch
    }
  | {
      readonly type: 'remove'
      readonly table: string
      readonly key: string
    }

export type RowChangeListener = (changes: readonly StoreRowChange[]) => void

export type GetRowFromTable<S extends ClientDatabaseSchema> = <Name extends TableName<S>>(
  tableName: Name,
  id: IdInputOf<Tables<S>[Name]>,
) => RowOf<Tables<S>[Name]> | undefined

export type SubscribeToRowChanges = (listener: RowChangeListener) => () => void

type RowTransition = {
  readonly table: string
  readonly key: string
  readonly before: StoreRow | undefined
  after: StoreRow | undefined
}

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

  readonly tables: Stores<S>
  readonly deleted: Map<string, null> = new Map()
  readonly #rowChangeListeners = new Set<RowChangeListener>()
  #transaction: Map<string, RowTransition> | undefined

  constructor(private readonly schema: S) {
    this.tables = Object.fromEntries(Object.keys(schema.tables).map(name => [name, new Map()])) as {
      [Name in TableName<S>]: TableStore<Tables<S>[Name]>
    }
  }

  getRowFromTable: GetRowFromTable<S> = (tableName, id) => {
    const table = this.tables[tableName] as Map<string, RowOf<Tables<S>[typeof tableName]>> | undefined
    if (!table) {
      throw new Error(`Unknown table "${tableName}"`)
    }

    return table.get(this.keyFor(tableName, id))
  }

  subscribeToRowChanges: SubscribeToRowChanges = listener => {
    this.#rowChangeListeners.add(listener)
    return () => {
      this.#rowChangeListeners.delete(listener)
    }
  }

  applyMutation(mutations: readonly Mutation<S>[]) {
    this.transact(() => {
      for (const mutation of mutations) {
        switch (mutation.type) {
          case 'INSERT': {
            this.setRow(mutation.table, this.keyFor(mutation.table, mutation.data), mutation.data)
            break
          }
          case 'UPDATE': {
            const key = this.keyFor(mutation.table, mutation.id)
            const existing = this.tableFor(mutation.table).get(key)
            if (existing) {
              this.setRow(mutation.table, key, { ...existing, ...mutation.changes })
            }
            break
          }
          case 'DELETE': {
            const key = this.keyFor(mutation.table, mutation.id)
            this.setRow(mutation.table, key, undefined)
            this.deleted.set(key, null)
            break
          }
        }
      }
    })
  }

  // Adds rows from a table-keyed response, but only fills in rows that are
  // currently absent. Used to seed the store without clobbering existing
  // (e.g. locally mutated) rows.
  addIfNotExist(rowsByTable: RowsByTable) {
    this.transact(() => {
      for (const [tableName, rows] of Object.entries(rowsByTable)) {
        const table = this.tableFor(tableName)

        for (const row of rows) {
          const key = this.keyFor(tableName, row)
          if (table.get(key) === undefined || this.deleted.has(key)) {
            this.setRow(tableName, key, row)
          }
        }
      }
    })
  }

  // Derives the Map key from a row or id object in primary-key order.
  private keyFor(tableName: string, record: unknown): string {
    return primaryKeyFor(this.schema.tables[tableName], record)
  }

  private transact(applyUpdates: () => void): void {
    if (this.#transaction) {
      applyUpdates()
      return
    }

    const transitions = new Map<string, RowTransition>()
    this.#transaction = transitions
    let changes: StoreRowChange[] | undefined

    try {
      applyUpdates()
      changes = []

      for (const transition of transitions.values()) {
        const { table, key, before, after } = transition
        if (before === undefined && after === undefined) continue

        if (before === undefined) {
          changes.push({ type: 'insert', table, key, row: after as StoreRow })
          continue
        }

        if (after === undefined) {
          changes.push({ type: 'remove', table, key })
          continue
        }

        const patch: Record<string, unknown> = {}
        const columns = new Set([...Object.keys(before), ...Object.keys(after)])

        for (const column of columns) {
          if (!Object.is(before[column], after[column])) {
            patch[column] = after[column]
          }
        }

        if (Object.keys(patch).length > 0) {
          changes.push({ type: 'update', table, key, changes: patch })
        }
      }
    } finally {
      this.#transaction = undefined
    }

    if (!changes || changes.length === 0) return
    for (const listener of this.#rowChangeListeners) listener(changes)
  }

  private setRow(tableName: string, key: string, row: StoreRow | undefined): void {
    const transaction = this.#transaction
    if (!transaction) {
      throw new Error('Store writes must run inside a transaction')
    }

    const table = this.tableFor(tableName)
    const txKey = `${tableName}\0${key}`
    let transition = transaction.get(txKey)
    if (!transition) {
      const before = table.get(key)
      transition = { table: tableName, key, before, after: before }
      transaction.set(txKey, transition)
    }

    if (row === undefined) {
      table.delete(key)
    } else {
      table.set(key, row as RowOf<TableSchema>)
    }

    transition.after = table.get(key)
  }

  private tableFor(tableName: string): Map<string, RowOf<TableSchema>> {
    const table = this.tables[tableName as TableName<S>] as Map<string, RowOf<TableSchema>> | undefined
    if (!table) {
      throw new Error(`Unknown table "${tableName}"`)
    }
    return table
  }
}
