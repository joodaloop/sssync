import type { TableSchema } from '@sssync/zero-schema'
import type { ChangeListener, QueryNodeSnapshot, RowDelta, RuntimeRow } from '../types'
import type { RowTable } from '../row-table'
import { rowId } from '../utils'

export abstract class QueryNode {
  readonly id: string
  readonly type: QueryNodeSnapshot['type']
  readonly label: string
  readonly table: string
  readonly tableSchema: TableSchema
  readonly rowTable: RowTable
  protected readonly ids = new Set<string>()
  readonly #listeners = new Set<ChangeListener<RuntimeRow>>()
  readonly #unsubscribes: (() => void)[] = []

  constructor(options: {
    readonly id: string
    readonly type: QueryNodeSnapshot['type']
    readonly label: string
    readonly table: string
    readonly tableSchema: TableSchema
    readonly rowTable: RowTable
  }) {
    this.id = options.id
    this.type = options.type
    this.label = options.label
    this.table = options.table
    this.tableSchema = options.tableSchema
    this.rowTable = options.rowTable
  }

  rows(): readonly RuntimeRow[] {
    const rows: RuntimeRow[] = []
    for (const id of this.ids) {
      const row = this.rowTable.get(id)
      if (row) {
        rows.push(row)
      }
    }
    return rows
  }

  idFor(row: RuntimeRow): string {
    return rowId(this.tableSchema, row)
  }

  subscribe(listener: ChangeListener<RuntimeRow>): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  snapshot(): QueryNodeSnapshot {
    return {
      id: this.id,
      type: this.type,
      label: this.label,
      table: this.table,
      rowCount: this.ids.size,
      rowIds: [...this.ids],
    }
  }

  dispose() {
    for (const unsubscribe of this.#unsubscribes) {
      unsubscribe()
    }
    this.#unsubscribes.length = 0
    this.#listeners.clear()
  }

  protected track(unsubscribe: () => void) {
    this.#unsubscribes.push(unsubscribe)
  }

  protected emit(change: RowDelta<RuntimeRow>) {
    for (const listener of this.#listeners) {
      listener(change)
    }
  }
}
