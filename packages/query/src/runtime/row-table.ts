import type { TableSchema } from '@sssync/zero-schema'
import type { Scalar } from '../types'
import type { ChangeListener, RowChange, RuntimeRow } from './types'
import { primaryKeyToId, rowId } from './utils'

export class RowTable {
  readonly #schema: TableSchema
  readonly #rows = new Map<string, RuntimeRow>()
  readonly #listeners = new Set<ChangeListener<RuntimeRow>>()

  constructor(schema: TableSchema) {
    this.#schema = schema
  }

  add(row: RuntimeRow): RowChange<RuntimeRow> {
    const id = rowId(this.#schema, row)
    if (this.#rows.has(id)) {
      throw new Error(`Row "${this.#schema.name}:${id}" already exists`)
    }

    this.#rows.set(id, row)
    const change = { type: 'add', table: this.#schema.name, id, row } as const
    this.#emit(change)
    return change
  }

  update(
    id: Scalar | readonly Scalar[],
    patch: Partial<RuntimeRow>,
  ): RowChange<RuntimeRow> {
    const key = primaryKeyToId(id)
    const old = this.#rows.get(key)
    if (!old) {
      throw new Error(`Row "${this.#schema.name}:${key}" does not exist`)
    }

    const row = { ...old, ...patch }
    const nextKey = rowId(this.#schema, row)
    if (nextKey !== key) {
      throw new Error('Updating primary key fields is not supported')
    }

    this.#rows.set(key, row)
    const change = { type: 'update', table: this.#schema.name, id: key, old, row } as const
    this.#emit(change)
    return change
  }

  delete(id: Scalar | readonly Scalar[]): RowChange<RuntimeRow> {
    const key = primaryKeyToId(id)
    const old = this.#rows.get(key)
    if (!old) {
      throw new Error(`Row "${this.#schema.name}:${key}" does not exist`)
    }

    this.#rows.delete(key)
    const change = { type: 'delete', table: this.#schema.name, id: key, old } as const
    this.#emit(change)
    return change
  }

  get(id: Scalar | readonly Scalar[]): RuntimeRow | undefined {
    return this.#rows.get(primaryKeyToId(id))
  }

  rows(): readonly RuntimeRow[] {
    return [...this.#rows.values()]
  }

  ids(): readonly string[] {
    return [...this.#rows.keys()]
  }

  subscribe(listener: ChangeListener<RuntimeRow>): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #emit(change: RowChange<RuntimeRow>) {
    for (const listener of this.#listeners) {
      listener(change)
    }
  }
}

export type RuntimeTables = Record<string, RowTable>
