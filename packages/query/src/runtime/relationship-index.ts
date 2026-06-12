import type { Relationship, Schema, TableSchema } from '@sssync/zero-schema'
import type { RowChange, RuntimeRow, EdgeChange, RelationshipTableChange } from './types'
import { RowTable } from './row-table'
import {
  addIndexEntry,
  cloneIndexForKeys,
  dedupeRows,
  fieldsKey,
  lookupMapKey,
  rowId,
  sourceByDest,
} from './utils'

export class RelationshipIndex {
  readonly #schema: Schema
  readonly #tables: Record<string, RowTable<RuntimeRow>>
  readonly #edges: EdgeIndex[]
  readonly #listeners = new Set<(change: EdgeChange) => void>()
  readonly #sourceTable: string
  readonly #destTable: string
  readonly #edgeSourceTables: readonly string[]
  readonly #sourceRowsByKey = new Map<string, RuntimeRow>()
  readonly #destIdsBySourceKey = new Map<string, Set<string>>()
  readonly #sourceKeysByRow = new Map<string, Map<string, Set<string>>>()
  readonly #sourceKeysByLookup = new Map<string, Map<string, Set<string>>>()
  readonly sourceField: readonly string[]

  constructor(options: {
    readonly schema: Schema
    readonly tables: Record<string, RowTable<RuntimeRow>>
    readonly sourceTable: string
    readonly relationship: Relationship
  }) {
    this.#schema = options.schema
    this.#tables = options.tables
    this.#sourceTable = options.sourceTable
    this.#destTable = options.relationship[options.relationship.length - 1].destSchema
    this.#edgeSourceTables = options.relationship.map((connection, index) =>
      index === 0 ? options.sourceTable : options.relationship[index - 1].destSchema,
    )
    this.sourceField = options.relationship[0].sourceField
    this.#edges = options.relationship.map(
      (connection, index) =>
        new EdgeIndex({
          schema: options.schema,
          table: options.tables[connection.destSchema],
          tableName: connection.destSchema,
          edgeIndex: index,
          sourceField: connection.sourceField,
          destField: connection.destField,
          onChange: change => this.#rebuildAndEmit(change),
        }),
    )
  }

  rowsFor(sourceRows: readonly RuntimeRow[]): RuntimeRow[] {
    const rows: RuntimeRow[] = []

    for (const source of sourceRows) {
      rows.push(...this.destRowsForSource(source))
    }

    return dedupeRows(this.#schema.tables[this.#destTable], rows)
  }

  rowForDestId(destId: string): RuntimeRow | undefined {
    return this.#tables[this.#destTable].get(destId)
  }

  destRowsForSource(source: RuntimeRow): RuntimeRow[] {
    return this.trackSource(source)
  }

  trackSource(source: RuntimeRow): RuntimeRow[] {
    this.#ensureSource(source)
    const destIds = this.#destIdsBySourceKey.get(this.sourceKey(source))
    if (!destIds) {
      return []
    }

    return [...destIds]
      .map(id => this.#tables[this.#destTable].get(id))
      .filter((row): row is RuntimeRow => row !== undefined)
  }

  untrackSource(source: RuntimeRow) {
    const sourceKey = this.sourceKey(source)
    this.#sourceRowsByKey.delete(sourceKey)
    this.#destIdsBySourceKey.delete(sourceKey)
    this.#removeReachabilityForSourceKey(sourceKey)
  }

  resetTrackedSources() {
    this.#sourceRowsByKey.clear()
    this.#destIdsBySourceKey.clear()
    this.#sourceKeysByRow.clear()
    this.#sourceKeysByLookup.clear()
  }

  sourceKey(row: RuntimeRow): string {
    return fieldsKey(row, this.sourceField)
  }

  subscribe(listener: (change: EdgeChange) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  dispose() {
    for (const edge of this.#edges) {
      edge.dispose()
    }
    this.#listeners.clear()
  }

  #emit(change: EdgeChange) {
    for (const listener of this.#listeners) {
      listener(change)
    }
  }

  #rebuildAndEmit(tableChange: RelationshipTableChange) {
    const sourceKeys = this.#affectedSourceKeys(tableChange)
    const previous = cloneIndexForKeys(this.#destIdsBySourceKey, sourceKeys)

    for (const sourceKey of sourceKeys) {
      this.#recomputeSourceKey(sourceKey)
    }

    const next = cloneIndexForKeys(this.#destIdsBySourceKey, sourceKeys)
    const previousSourceByDest = sourceByDest(previous)
    const nextSourceByDest = sourceByDest(next)
    const movedDestIds = new Set<string>()
    const updatedDestIds = new Set<string>()

    for (const [destId, oldSourceKey] of previousSourceByDest) {
      const sourceKey = nextSourceByDest.get(destId)
      if (!sourceKey || sourceKey === oldSourceKey) {
        continue
      }

      const rows = this.#changedRowsForDest(destId, tableChange)
      if (rows) {
        movedDestIds.add(destId)
        this.#emit({
          type: 'move',
          oldSourceKey,
          sourceKey,
          destId,
          old: rows.old,
          row: rows.row,
        })
      }
    }

    for (const [sourceKey, oldDestIds] of previous) {
      const nextDestIds = next.get(sourceKey) ?? new Set()
      for (const destId of oldDestIds) {
        if (!nextDestIds.has(destId) && !movedDestIds.has(destId)) {
          const old = this.#oldRowForDest(destId, tableChange)
          if (old) {
            this.#emit({ type: 'delete', sourceKey, destId, old })
          }
        }
      }
    }

    for (const [sourceKey, nextDestIds] of next) {
      const oldDestIds = previous.get(sourceKey) ?? new Set()
      for (const destId of nextDestIds) {
        if (movedDestIds.has(destId)) {
          continue
        }
        const row = this.rowForDestId(destId)
        if (!row) {
          continue
        }
        if (oldDestIds.has(destId)) {
          if (updatedDestIds.has(destId)) {
            continue
          }
          const rows = this.#changedRowsForDest(destId, tableChange)
          if (
            rows &&
            tableChange.tableName === this.#destTable &&
            tableChange.change.type === 'update'
          ) {
            updatedDestIds.add(destId)
            this.#emit({ type: 'update', sourceKey, destId, old: rows.old, row: rows.row })
          }
        } else {
          this.#emit({ type: 'add', sourceKey, destId, row })
        }
      }
    }
  }

  #ensureSource(source: RuntimeRow) {
    const sourceKey = this.sourceKey(source)
    if (this.#sourceRowsByKey.get(sourceKey) === source) {
      return
    }

    this.#sourceRowsByKey.set(sourceKey, source)
    this.#recomputeSourceKey(sourceKey)
  }

  #recomputeSourceKey(sourceKey: string) {
    this.#removeReachabilityForSourceKey(sourceKey)
    const source = this.#sourceRowsByKey.get(sourceKey)
    if (!source) {
      this.#destIdsBySourceKey.delete(sourceKey)
      return
    }

    this.#destIdsBySourceKey.set(sourceKey, this.#computeDestIds(sourceKey, source))
  }

  #computeDestIds(sourceKey: string, source: RuntimeRow): Set<string> {
    const rows = this.#followFromSource(sourceKey, source)
    return new Set(rows.map(row => rowId(this.#schema.tables[this.#destTable], row)))
  }

  #followFromSource(sourceKey: string, source: RuntimeRow): RuntimeRow[] {
    let currentRows = [source]
    let currentTable = this.#sourceTable

    for (const edge of this.#edges) {
      const nextRows: RuntimeRow[] = []
      for (const row of currentRows) {
        this.#recordReachableRow(sourceKey, currentTable, row)
        this.#recordReachableLookup(sourceKey, currentTable, edge.sourceField, row)

        for (const destId of edge.destIdsForSource(row)) {
          const dest = this.#tables[edge.tableName].get(destId)
          if (dest) {
            nextRows.push(dest)
          }
        }
      }
      currentTable = edge.tableName
      currentRows = dedupeRows(this.#schema.tables[currentTable], nextRows)
    }

    for (const row of currentRows) {
      this.#recordReachableRow(sourceKey, currentTable, row)
    }

    return currentRows
  }

  #affectedSourceKeys(tableChange: RelationshipTableChange): Set<string> {
    const sourceKeys = new Set<string>()
    const edge = this.#edges[tableChange.edgeIndex]
    const edgeSourceTable = this.#edgeSourceTables[tableChange.edgeIndex]
    const addSourceKey = (sourceKey: string) => {
      if (tableChange.edgeIndex === 0) {
        sourceKeys.add(sourceKey)
      }

      for (const key of this.#sourceKeysForLookup(
        edgeSourceTable,
        edge.sourceField,
        sourceKey,
      )) {
        sourceKeys.add(key)
      }
    }

    for (const key of this.#sourceKeysForRow(tableChange.tableName, tableChange.change.destId)) {
      sourceKeys.add(key)
    }

    addSourceKey(tableChange.change.sourceKey)
    if (tableChange.change.type === 'move') {
      addSourceKey(tableChange.change.oldSourceKey)
    }

    return sourceKeys
  }

  #sourceKeysForRow(tableName: string, rowId: string): readonly string[] {
    return [...(this.#sourceKeysByRow.get(tableName)?.get(rowId) ?? [])]
  }

  #sourceKeysForLookup(
    tableName: string,
    fields: readonly string[],
    key: string,
  ): readonly string[] {
    return [
      ...(this.#sourceKeysByLookup
        .get(lookupMapKey(tableName, fields))
        ?.get(key) ?? []),
    ]
  }

  #recordReachableRow(sourceKey: string, tableName: string, row: RuntimeRow) {
    const table = this.#schema.tables[tableName]
    let rows = this.#sourceKeysByRow.get(tableName)
    if (!rows) {
      rows = new Map()
      this.#sourceKeysByRow.set(tableName, rows)
    }
    addIndexEntry(rows, rowId(table, row), sourceKey)
  }

  #recordReachableLookup(
    sourceKey: string,
    tableName: string,
    fields: readonly string[],
    row: RuntimeRow,
  ) {
    const key = lookupMapKey(tableName, fields)
    let lookups = this.#sourceKeysByLookup.get(key)
    if (!lookups) {
      lookups = new Map()
      this.#sourceKeysByLookup.set(key, lookups)
    }
    addIndexEntry(lookups, fieldsKey(row, fields), sourceKey)
  }

  #removeReachabilityForSourceKey(sourceKey: string) {
    for (const rows of this.#sourceKeysByRow.values()) {
      for (const [rowId, sourceKeys] of rows) {
        sourceKeys.delete(sourceKey)
        if (sourceKeys.size === 0) {
          rows.delete(rowId)
        }
      }
    }

    for (const lookups of this.#sourceKeysByLookup.values()) {
      for (const [key, sourceKeys] of lookups) {
        sourceKeys.delete(sourceKey)
        if (sourceKeys.size === 0) {
          lookups.delete(key)
        }
      }
    }
  }

  #oldRowForDest(
    destId: string,
    tableChange: RelationshipTableChange,
  ): RuntimeRow | undefined {
    if (tableChange.tableName === this.#destTable && tableChange.change.destId === destId) {
      return 'old' in tableChange.change
        ? tableChange.change.old
        : tableChange.change.row
    }

    return this.rowForDestId(destId)
  }

  #changedRowsForDest(
    destId: string,
    tableChange: RelationshipTableChange,
  ): { readonly old: RuntimeRow; readonly row: RuntimeRow } | undefined {
    if (tableChange.tableName !== this.#destTable || tableChange.change.destId !== destId) {
      const row = this.rowForDestId(destId)
      return row ? { old: row, row } : undefined
    }

    const change = tableChange.change
    if (change.type === 'delete') {
      return undefined
    }
    if (change.type === 'add') {
      return { old: change.row, row: change.row }
    }
    return { old: change.old, row: change.row }
  }
}

class EdgeIndex {
  readonly tableName: string
  readonly edgeIndex: number
  readonly sourceField: readonly string[]
  readonly #tableSchema: TableSchema
  readonly #table: RowTable<RuntimeRow>
  readonly #destField: readonly string[]
  readonly #destIdsBySourceKey = new Map<string, Set<string>>()
  readonly #unsubscribe: () => void
  readonly #onChange: ((change: RelationshipTableChange) => void) | undefined

  constructor(options: {
    readonly schema: Schema
    readonly table: RowTable<RuntimeRow>
    readonly tableName: string
    readonly edgeIndex: number
    readonly sourceField: readonly string[]
    readonly destField: readonly string[]
    readonly onChange?: ((change: RelationshipTableChange) => void) | undefined
  }) {
    this.tableName = options.tableName
    this.edgeIndex = options.edgeIndex
    this.sourceField = options.sourceField
    this.#tableSchema = options.schema.tables[options.tableName]
    this.#table = options.table
    this.#destField = options.destField
    this.#onChange = options.onChange

    for (const row of options.table.rows()) {
      this.#add(rowId(this.#tableSchema, row), row)
    }
    this.#unsubscribe = options.table.subscribe(change => this.#apply(change))
  }

  destIdsForSource(source: RuntimeRow): readonly string[] {
    return [...(this.#destIdsBySourceKey.get(fieldsKey(source, this.sourceField)) ?? [])]
  }

  dispose() {
    this.#unsubscribe()
  }

  #apply(change: RowChange<RuntimeRow>) {
    if (change.type === 'add') {
      this.#add(change.id, change.row)
      this.#onChange?.({
        tableName: this.tableName,
        edgeIndex: this.edgeIndex,
        change: {
          type: 'add',
          sourceKey: fieldsKey(change.row, this.#destField),
          destId: change.id,
          row: change.row,
        },
      })
    } else if (change.type === 'delete') {
      this.#remove(change.id, change.old)
      this.#onChange?.({
        tableName: this.tableName,
        edgeIndex: this.edgeIndex,
        change: {
          type: 'delete',
          sourceKey: fieldsKey(change.old, this.#destField),
          destId: change.id,
          old: change.old,
        },
      })
    } else {
      const oldSourceKey = fieldsKey(change.old, this.#destField)
      const sourceKey = fieldsKey(change.row, this.#destField)
      this.#remove(change.id, change.old)
      this.#add(change.id, change.row)
      this.#onChange?.({
        tableName: this.tableName,
        edgeIndex: this.edgeIndex,
        change:
          oldSourceKey === sourceKey
            ? {
                type: 'update',
                sourceKey,
                destId: change.id,
                old: change.old,
                row: change.row,
              }
            : {
                type: 'move',
                oldSourceKey,
                sourceKey,
                destId: change.id,
                old: change.old,
                row: change.row,
              },
      })
    }
  }

  #add(id: string, row: RuntimeRow) {
    addIndexEntry(this.#destIdsBySourceKey, fieldsKey(row, this.#destField), id)
  }

  #remove(id: string, row: RuntimeRow) {
    const key = fieldsKey(row, this.#destField)
    const ids = this.#destIdsBySourceKey.get(key)
    ids?.delete(id)
    if (ids?.size === 0) {
      this.#destIdsBySourceKey.delete(key)
    }
  }
}
