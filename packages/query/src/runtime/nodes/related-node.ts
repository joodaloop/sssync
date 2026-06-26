import type { Schema } from '@sssync/zero-schema'
import type { EdgeChange, RowDelta, RuntimeRow } from '../types'
import type {
  RowRelationshipPathIndex,
  RowRelationshipsIndex,
} from '../row-relationships-index'
import type { RowTable } from '../row-table'
import { addIndexEntry, removeIndexEntry } from '../utils'
import { QueryNode } from './query-node'

export class RelatedNode extends QueryNode {
  readonly #input: QueryNode
  readonly #index: RowRelationshipPathIndex
  readonly #sourceIdsByKey = new Map<string, Set<string>>()
  readonly #destIdsBySourceId = new Map<string, Set<string>>()
  readonly #destRefCounts = new Map<string, number>()

  constructor(options: {
    readonly id: string
    readonly schema: Schema
    readonly input: QueryNode
    readonly rowRelationships: RowRelationshipsIndex
    readonly targetRows: RowTable
    readonly sourceTable: string
    readonly targetTable: string
    readonly relationshipName: string
  }) {
    super({
      id: options.id,
      type: 'related',
      label: `related(${options.relationshipName})`,
      table: options.targetTable,
      tableSchema: options.schema.tables[options.targetTable],
      rowTable: options.targetRows,
    })
    this.#input = options.input
    this.#index = options.rowRelationships.get(
      options.sourceTable,
      options.relationshipName,
    )

    this.#rebuildFromInput()
    this.track(options.input.subscribe(change => this.applySourceChange(change)))
    this.track(this.#index.subscribe(change => this.applyEdgeChange(change)))
  }

  addSource(id: string, row: RuntimeRow, emit: boolean) {
    addIndexEntry(this.#sourceIdsByKey, this.sourceKey(row), id)

    const destIds = new Set(this.#index.destIdsBySourceId.get(id) ?? [])
    for (const destId of [...destIds]) {
      const dest = this.rowTable.get(destId)
      if (!dest) {
        destIds.delete(destId)
        continue
      }
      this.retainDest(destId, dest, emit)
    }

    this.#destIdsBySourceId.set(id, destIds)
  }

  removeSource(id: string, row: RuntimeRow, emit: boolean) {
    removeIndexEntry(this.#sourceIdsByKey, this.sourceKey(row), id)
    const destIds = this.#destIdsBySourceId.get(id) ?? new Set()

    for (const destId of destIds) {
      this.releaseDest(destId, this.rowTable.get(destId), emit)
    }

    this.#destIdsBySourceId.delete(id)
  }

  applySourceChange(change: RowDelta<RuntimeRow>) {
    if (change.type === 'add') {
      this.addSource(change.id, change.row, true)
    } else if (change.type === 'delete') {
      this.removeSource(change.id, change.old, true)
    } else if (this.sourceKey(change.old) !== this.sourceKey(change.row)) {
      this.removeSource(change.id, change.old, true)
      this.addSource(change.id, change.row, true)
    }
  }

  applyEdgeChange(change: EdgeChange) {
    if (change.type === 'add') {
      this.addDestForSourceKey(change.sourceKey, change.destId, change.row)
    } else if (change.type === 'delete') {
      this.removeDestForSourceKey(change.sourceKey, change.destId, change.old)
    } else if (change.type === 'update') {
      if (this.ids.has(change.destId)) {
        this.emit({
          type: 'update',
          table: this.table,
          id: change.destId,
          old: change.old,
          row: change.row,
        })
      }
    } else {
      this.moveDestBetweenSourceKeys(change)
    }
  }

  addDestForSourceKey(sourceKey: string, destId: string, dest: RuntimeRow) {
    for (const sourceId of this.#sourceIdsByKey.get(sourceKey) ?? []) {
      let destIds = this.#destIdsBySourceId.get(sourceId)
      if (!destIds) {
        destIds = new Set()
        this.#destIdsBySourceId.set(sourceId, destIds)
      }
      if (destIds.has(destId)) {
        continue
      }
      destIds.add(destId)
      this.retainDest(destId, dest, true)
    }
  }

  removeDestForSourceKey(sourceKey: string, destId: string, old: RuntimeRow) {
    for (const sourceId of this.#sourceIdsByKey.get(sourceKey) ?? []) {
      const destIds = this.#destIdsBySourceId.get(sourceId)
      if (!destIds?.delete(destId)) {
        continue
      }
      this.releaseDest(destId, old, true)
    }
  }

  moveDestBetweenSourceKeys(change: Extract<EdgeChange, { type: 'move' }>) {
    const oldSourceIds = [...(this.#sourceIdsByKey.get(change.oldSourceKey) ?? [])]
      .filter(sourceId => this.#destIdsBySourceId.get(sourceId)?.has(change.destId))
    const newSourceIds = [...(this.#sourceIdsByKey.get(change.sourceKey) ?? [])]
      .filter(sourceId => !this.#destIdsBySourceId.get(sourceId)?.has(change.destId))

    for (const sourceId of oldSourceIds) {
      this.#destIdsBySourceId.get(sourceId)?.delete(change.destId)
    }

    for (const sourceId of newSourceIds) {
      let destIds = this.#destIdsBySourceId.get(sourceId)
      if (!destIds) {
        destIds = new Set()
        this.#destIdsBySourceId.set(sourceId, destIds)
      }
      destIds.add(change.destId)
    }

    const oldCount = this.#destRefCounts.get(change.destId) ?? 0
    const nextCount = oldCount - oldSourceIds.length + newSourceIds.length

    if (oldCount > 0 && nextCount > 0) {
      this.#destRefCounts.set(change.destId, nextCount)
      this.emit({
        type: 'update',
        table: this.table,
        id: change.destId,
        old: change.old,
        row: change.row,
      })
    } else if (oldCount > 0 && nextCount <= 0) {
      this.#destRefCounts.delete(change.destId)
      if (this.ids.delete(change.destId)) {
        this.emit({
          type: 'delete',
          table: this.table,
          id: change.destId,
          old: change.old,
        })
      }
    } else if (oldCount === 0 && nextCount > 0) {
      this.#destRefCounts.set(change.destId, nextCount)
      this.ids.add(change.destId)
      this.emit({
        type: 'add',
        table: this.table,
        id: change.destId,
        row: change.row,
      })
    }
  }

  retainDest(destId: string, dest: RuntimeRow, emit: boolean) {
    const count = this.#destRefCounts.get(destId) ?? 0
    this.#destRefCounts.set(destId, count + 1)
    if (count === 0) {
      this.ids.add(destId)
      if (emit) {
        this.emit({
          type: 'add',
          table: this.table,
          id: destId,
          row: dest,
        })
      }
    }
  }

  releaseDest(destId: string, old: RuntimeRow | undefined, emit: boolean) {
    const count = this.#destRefCounts.get(destId) ?? 0
    if (count <= 1) {
      this.#destRefCounts.delete(destId)
      const wasOutput = this.ids.delete(destId)
      if (emit && wasOutput && old) {
        this.emit({
          type: 'delete',
          table: this.table,
          id: destId,
          old,
        })
      }
    } else {
      this.#destRefCounts.set(destId, count - 1)
    }
  }

  sourceKey(row: RuntimeRow): string {
    return this.#index.sourceKey(row)
  }

  #rebuildFromInput() {
    this.#sourceIdsByKey.clear()
    this.#destIdsBySourceId.clear()
    this.#destRefCounts.clear()
    this.ids.clear()

    for (const source of this.#input.rows()) {
      this.addSource(this.#input.idFor(source), source, false)
    }
  }
}
