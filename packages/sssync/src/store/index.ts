import type { Mutation } from '../mutators/types'
import type { IdInputOf, RowOf, TableName, Tables } from '../schema/infer'
import type { ClientDatabaseSchema, TableSchema } from '../schema/table-schema'
import { primaryKeyFor } from '../shared'

// The diff is `readonly DiffOperation[]` where each op is `{op:'add', key, newValue}` | `{op:'del', key, oldValue}` | `{op:'change', key, oldValue, newValue}`. The callback is never invoked with an empty diff. This add/del/change triple with old+new values is the canonical shape — worth matching exactly so downstream consumers can be generic.

export type RowsByTable<S extends ClientDatabaseSchema> = Readonly<
  Partial<{
    readonly [Name in TableName<S>]: readonly RowOf<Tables<S>[Name]>[]
  }>
>
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
  // Whether the key was present in the table before this transaction. Tells a
  // pre-existing tombstone (present, value undefined) apart from a never-seen
  // row (absent) when rolling back.
  readonly beforeExisted: boolean
  after: StoreRow | undefined
}

/**
 * The Map key for a row, encoded from the schema's primary-key values.
 */
export type RowKeyOf<_T extends TableSchema> = string

/**
 * One in-memory table: rows keyed by their primary key.
 *
 * Row presence is `.has(key)`, not the value: a key present with value
 * `undefined` is a tombstone (deleted locally, kept so a server seed won't
 * resurrect it); a key that isn't present is a row never seen.
 */
export type TableStore<T extends TableSchema> = Map<RowKeyOf<T>, RowOf<T> | undefined>

export type Stores<S extends ClientDatabaseSchema> = {
  readonly [Name in TableName<S>]: TableStore<Tables<S>[Name]>
}

// Holds a JavaScript Map per table and applies batches of INSERT/UPDATE/DELETE
// mutations to them.
export class Store<S extends ClientDatabaseSchema> {
  readonly tables: Stores<S>
  readonly #schema: S
  readonly #rowChangeListeners = new Set<RowChangeListener>()
  #transaction: Map<string, RowTransition> | undefined

  constructor(schema: S) {
    this.#schema = schema
    this.tables = Object.fromEntries(Object.keys(schema.tables).map(name => [name, new Map()])) as {
      [Name in TableName<S>]: TableStore<Tables<S>[Name]>
    }
  }

  getRowFromTable: GetRowFromTable<S> = (tableName, id) => {
    return this.tableFor(tableName).get(this.keyFor(tableName, id)) as
      | RowOf<Tables<S>[typeof tableName]>
      | undefined
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
        this.applyOne(mutation)
      }
    })
  }

  applySyncerUpdate(mutations: readonly Mutation<S>[]) {
    // undo mutations
    this.transact(() => {
      for (const mutation of mutations) {
        this.applyOne(mutation)
      }
    })
    // redo mutations
  }

  // Adds rows from a table-keyed response, but only fills in rows that are
  // currently absent. Used to seed the store without clobbering existing
  // (e.g. locally mutated) rows.
  addIfNotExist(rowsByTable: RowsByTable<S>) {
    this.transact(() => {
      // undo mutations

      for (const [tableName, rows] of Object.entries(rowsByTable) as [string, readonly StoreRow[]][]) {
        const table = this.tableFor(tableName)

        for (const row of rows) {
          const key = this.keyFor(tableName, row)
          // Seed only rows never seen. A present key is either live (don't
          // clobber) or a tombstone (don't resurrect) — both should be left be.
          if (!table.has(key)) {
            this.setRow(tableName, key, row)
          }
        }
      }

      // redo mutations
    })
  }

  // Derives the Map key from a row or id object in primary-key order.
  private keyFor(tableName: string, record: unknown): string {
    return primaryKeyFor(this.#schema.tables[tableName], record)
  }

  private transact(applyUpdates: () => void): void {
    // Re-entrant: a nested call joins the in-progress transaction, writing into
    // the same transitions map. The outermost call owns commit/rollback and
    // fires listeners once, so a group of nested writes lands as one change set.
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
    } catch (error) {
      // Restore every row this transaction touched to its pre-transaction value,
      // so a mid-batch throw leaves the store unchanged rather than half-applied.
      // No listeners fire, since `changes` is never assigned.
      this.rollback(transitions)
      throw error
    } finally {
      this.#transaction = undefined
    }

    if (!changes || changes.length === 0) return
    for (const listener of this.#rowChangeListeners) listener(changes)
  }

  // Reverts each touched row to its pre-transaction state: restore the prior
  // value if the key existed (which may be a tombstone), otherwise drop the key.
  private rollback(transitions: Map<string, RowTransition>): void {
    for (const { table, key, before, beforeExisted } of transitions.values()) {
      const store = this.tableFor(table)
      if (beforeExisted) {
        store.set(key, before as RowOf<TableSchema> | undefined)
      } else {
        store.delete(key)
      }
    }
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
      transition = { table: tableName, key, before, beforeExisted: table.has(key), after: before }
      transaction.set(txKey, transition)
    }

    // Keep the key even when removing: a present key with value `undefined` is a
    // tombstone, which `addIfNotExist` uses to avoid resurrecting a deleted row.
    table.set(key, row as RowOf<TableSchema> | undefined)

    transition.after = table.get(key)
  }

  private tableFor(tableName: string): Map<string, RowOf<TableSchema> | undefined> {
    const table = this.tables[tableName as TableName<S>] as
      | Map<string, RowOf<TableSchema> | undefined>
      | undefined
    if (!table) {
      throw new Error(`Unknown table "${tableName}"`)
    }
    return table
  }

  private applyOne(mutation: Mutation<S>): void {
    switch (mutation.type) {
      case 'INSERT': {
        this.setRow(mutation.table, this.keyFor(mutation.table, mutation.data), mutation.data)
        break
      }
      case 'UPDATE': {
        const key = this.keyFor(mutation.table, mutation.id)
        const table = this.tableFor(mutation.table)
        const existing = table.get(key)
        if (existing !== undefined) {
          this.setRow(mutation.table, key, { ...existing, ...mutation.changes })
        } else if (table.has(key)) {
          throw new Error(`Cannot UPDATE deleted "${mutation.table}" row ${key}`)
        } else {
          console.warn(`UPDATE ignored for missing "${mutation.table}" row ${key}`)
        }
        break
      }
      case 'DELETE': {
        const key = this.keyFor(mutation.table, mutation.id)
        this.setRow(mutation.table, key, undefined)
        break
      }
    }
  }
}
