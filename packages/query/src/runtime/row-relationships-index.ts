import type { Relationship, Schema, TableSchema } from '@sssync/zero-schema'
import type { EdgeChange, RuntimeRow } from './types'
import { RelationshipIndex } from './relationship-index'
import { RowTable } from './row-table'
import { addIndexEntry, dedupeRows, removeIndexEntry, rowId } from './utils'

export type RelationshipPathKey = `${string}.${string}`

export type RowRelationshipHopIndex = {
  readonly sourceTable: string
  readonly destTable: string
  readonly sourceField: readonly string[]
  readonly destField: readonly string[]
}

export class RowRelationshipPathIndex {
  readonly sourceTable: string
  readonly relationshipName: string
  readonly destTable: string
  readonly hops: readonly RowRelationshipHopIndex[]
  readonly destIdsBySourceId = new Map<string, Set<string>>()
  readonly sourceIdsByDestId = new Map<string, Set<string>>()

  readonly #schema: Schema
  readonly #sourceTableSchema: TableSchema
  readonly #sourceTable: RowTable
  readonly #relationshipIndex: RelationshipIndex
  readonly #sourceIdsByKey = new Map<string, Set<string>>()
  readonly #listeners = new Set<(change: EdgeChange) => void>()
  readonly #unsubscribes: (() => void)[] = []

  constructor(options: {
    readonly schema: Schema
    readonly tables: Record<string, RowTable>
    readonly sourceTable: string
    readonly relationshipName: string
    readonly relationship: Relationship
  }) {
    this.#schema = options.schema
    this.sourceTable = options.sourceTable
    this.relationshipName = options.relationshipName
    this.destTable = options.relationship[options.relationship.length - 1].destSchema
    this.hops = options.relationship.map((connection, index) => ({
      sourceTable:
        index === 0 ? options.sourceTable : options.relationship[index - 1].destSchema,
      destTable: connection.destSchema,
      sourceField: connection.sourceField,
      destField: connection.destField,
    }))
    this.#sourceTableSchema = options.schema.tables[options.sourceTable]
    this.#sourceTable = options.tables[options.sourceTable]
    this.#relationshipIndex = new RelationshipIndex({
      schema: options.schema,
      tables: options.tables,
      sourceTable: options.sourceTable,
      relationship: options.relationship,
    })

    this.#unsubscribes.push(
      this.#relationshipIndex.subscribe(change => this.#applyRelationshipChange(change)),
      this.#sourceTable.subscribe(change => {
        if (change.type === 'add') {
          this.#addSource(change.id, change.row)
        } else if (change.type === 'delete') {
          this.#removeSource(change.id, change.old)
        } else {
          this.#removeSource(change.id, change.old)
          this.#addSource(change.id, change.row)
        }
      }),
    )

    for (const row of this.#sourceTable.rows()) {
      this.#addSource(rowId(this.#sourceTableSchema, row), row)
    }
  }

  sourceKey(row: RuntimeRow): string {
    return this.#relationshipIndex.sourceKey(row)
  }

  rowsFor(sourceRows: readonly RuntimeRow[]): RuntimeRow[] {
    const rows: RuntimeRow[] = []
    for (const source of sourceRows) {
      rows.push(...this.destRowsForSource(source))
    }
    return dedupeRows(this.#schema.tables[this.destTable], rows)
  }

  destRowsForSource(source: RuntimeRow): RuntimeRow[] {
    const sourceId = rowId(this.#sourceTableSchema, source)
    return [...(this.destIdsBySourceId.get(sourceId) ?? [])]
      .map(id => this.#relationshipIndex.rowForDestId(id))
      .filter((row): row is RuntimeRow => row !== undefined)
  }

  subscribe(listener: (change: EdgeChange) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  dispose() {
    for (const unsubscribe of this.#unsubscribes) {
      unsubscribe()
    }
    this.#unsubscribes.length = 0
    this.#relationshipIndex.dispose()
    this.#listeners.clear()
  }

  #emit(change: EdgeChange) {
    for (const listener of this.#listeners) {
      listener(change)
    }
  }

  #addSource(id: string, row: RuntimeRow) {
    addIndexEntry(this.#sourceIdsByKey, this.sourceKey(row), id)
    this.#rebuildSource(id, row)
  }

  #removeSource(id: string, row: RuntimeRow) {
    this.#removeSourceDestIds(id)
    removeIndexEntry(this.#sourceIdsByKey, this.sourceKey(row), id)
    if (!this.#sourceIdsByKey.has(this.sourceKey(row))) {
      this.#relationshipIndex.untrackSource(row)
    }
  }

  #rebuildSource(id: string, row: RuntimeRow) {
    const destRows = this.#relationshipIndex.trackSource(row)
    const destIds = new Set(
      destRows.map(dest => rowId(this.#schema.tables[this.destTable], dest)),
    )

    this.#removeSourceDestIds(id)
    this.destIdsBySourceId.set(id, destIds)
    for (const destId of destIds) {
      addIndexEntry(this.sourceIdsByDestId, destId, id)
    }
  }

  #removeSourceDestIds(sourceId: string) {
    const destIds = this.destIdsBySourceId.get(sourceId) ?? new Set()
    for (const destId of destIds) {
      removeIndexEntry(this.sourceIdsByDestId, destId, sourceId)
    }
    this.destIdsBySourceId.delete(sourceId)
  }

  #applyRelationshipChange(change: EdgeChange) {
    if (change.type === 'add') {
      for (const sourceId of this.#sourceIdsByKey.get(change.sourceKey) ?? []) {
        this.#addDestForSource(sourceId, change.destId)
      }
    } else if (change.type === 'delete') {
      for (const sourceId of this.#sourceIdsByKey.get(change.sourceKey) ?? []) {
        this.#removeDestForSource(sourceId, change.destId)
      }
    } else if (change.type === 'move') {
      for (const sourceId of this.#sourceIdsByKey.get(change.oldSourceKey) ?? []) {
        this.#removeDestForSource(sourceId, change.destId)
      }
      for (const sourceId of this.#sourceIdsByKey.get(change.sourceKey) ?? []) {
        this.#addDestForSource(sourceId, change.destId)
      }
    }

    this.#emit(change)
  }

  #addDestForSource(sourceId: string, destId: string) {
    let destIds = this.destIdsBySourceId.get(sourceId)
    if (!destIds) {
      destIds = new Set()
      this.destIdsBySourceId.set(sourceId, destIds)
    }
    destIds.add(destId)
    addIndexEntry(this.sourceIdsByDestId, destId, sourceId)
  }

  #removeDestForSource(sourceId: string, destId: string) {
    const destIds = this.destIdsBySourceId.get(sourceId)
    destIds?.delete(destId)
    if (destIds?.size === 0) {
      this.destIdsBySourceId.delete(sourceId)
    }
    removeIndexEntry(this.sourceIdsByDestId, destId, sourceId)
  }
}

export class RowRelationshipsIndex {
  readonly #paths = new Map<RelationshipPathKey, RowRelationshipPathIndex>()

  constructor(schema: Schema, tables: Record<string, RowTable>) {
    for (const [sourceTable, relationships] of Object.entries(schema.relationships)) {
      for (const [relationshipName, relationship] of Object.entries(relationships)) {
        const key = relationshipPathKey(sourceTable, relationshipName)
        this.#paths.set(
          key,
          new RowRelationshipPathIndex({
            schema,
            tables,
            sourceTable,
            relationshipName,
            relationship,
          }),
        )
      }
    }
  }

  get(sourceTable: string, relationshipName: string): RowRelationshipPathIndex {
    const key = relationshipPathKey(sourceTable, relationshipName)
    const path = this.#paths.get(key)
    if (!path) {
      throw new Error(`Unknown relationship "${relationshipName}" on table "${sourceTable}"`)
    }
    return path
  }

  dispose() {
    for (const path of this.#paths.values()) {
      path.dispose()
    }
    this.#paths.clear()
  }
}

export function relationshipPathKey(
  sourceTable: string,
  relationshipName: string,
): RelationshipPathKey {
  return `${sourceTable}.${relationshipName}`
}
