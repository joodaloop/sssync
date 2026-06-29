import { safeValidate } from '../json-validator'
import { rowSchemaFor } from '../schema/row-schema'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import { cacheKeyForItem, rowKeyForItem } from '../shared'
import type { BatchStats, MergedRequest, Observable, ResolvedItem } from '../shared'
import type { RowsByTable } from '../store'

export type ResolvedBatch = {
  readonly items: readonly ResolvedItem[]
  readonly success: boolean
}

// Collapses requests for the same model + id into a single payload entry,
// gathering all of their relations into one array. A bare-row request and its
// related-relation requests for the same id go out as one request.
export function mergeRequests(items: readonly ResolvedItem[]): MergedRequest[] {
  const merged = new Map<string, { modelName: string; id: unknown; relations: string[] }>()

  for (const item of items) {
    const key = rowKeyForItem(item)
    let entry = merged.get(key)
    if (!entry) {
      entry = { modelName: item.modelName, id: item.id, relations: [] }
      merged.set(key, entry)
    }
    if (item.relation && !entry.relations.includes(item.relation)) {
      entry.relations.push(item.relation)
    }
  }

  return [...merged.values()]
}

export class Batcher<S extends ClientDatabaseSchema> {
  readonly wait = 100
  private readonly inflight = new Map<string, ResolvedItem>()
  private readonly pending = new Map<string, ResolvedItem>()
  // One row validator per table, derived from the schema's write columns.
  private readonly rowValidators: Record<string, ReturnType<typeof rowSchemaFor>>
  timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly schema: S,
    private readonly batchURL: string,
    private readonly batches: Observable<BatchStats>,
    private readonly addIfNotExist: (rowsByTable: RowsByTable<S>) => void,
    private readonly resolve: (batch: ResolvedBatch) => void,
  ) {
    this.rowValidators = Object.fromEntries(
      Object.entries(schema.tables).map(([name, table]) => [name, rowSchemaFor(table)]),
    )
  }

  // Validates the server payload of `{ tableName: rows }` against each table's
  // write schema. Returns typed rows on success.
  private validatePayload(payload: unknown): RowsByTable<S> | undefined {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      console.warn('Batch response was not an object of rows')
      return undefined
    }

    const rowsByTable: Record<string, readonly Record<string, unknown>[]> = {}
    for (const [tableName, rows] of Object.entries(payload)) {
      const validator = this.rowValidators[tableName]
      if (!validator) {
        console.warn(`Batch response referenced unknown table "${tableName}"`)
        return undefined
      }
      if (!Array.isArray(rows)) {
        console.warn(`Rows for table "${tableName}" were not an array`)
        return undefined
      }
      const validatedRows: Record<string, unknown>[] = []
      for (const row of rows) {
        const result = safeValidate(validator, row)
        if (!result.success) {
          const message = result.issues.map(issue => issue.message).join('; ')
          console.warn(`Invalid "${tableName}" row: ${message}`)
          return undefined
        }
        validatedRows.push(result.output)
      }
      rowsByTable[tableName] = validatedRows
    }

    return rowsByTable as RowsByTable<S>
  }

  request(item: ResolvedItem) {
    const key = cacheKeyForItem(item)
    if (this.pending.has(key)) return
    if (this.inflight.has(key)) return
    this.pending.set(key, item)
    this.publish()
    this.timer ??= setTimeout(() => void this.flush(), this.wait)
  }

  flush = async () => {
    this.timer = undefined
    const entries = [...this.pending]
    if (entries.length === 0) return
    this.pending.clear()

    const items = entries.map(([, item]) => item)
    for (const [k, item] of entries) this.inflight.set(k, item)
    this.publish()
    try {
      const res = await fetch(this.batchURL, {
        method: 'POST',
        body: JSON.stringify(mergeRequests(items)),
      })
      if (!res.ok) {
        throw new Error(`Batch fetch failed: ${res.status} ${res.statusText}`)
      }
      // Only report success if every incoming row passes its write schema.
      const payload = await res.json()
      const rowsByTable = this.validatePayload(payload)
      // Seed the validated rows into the store before resolving, so waiters see
      // the data the moment their request settles. Invalid payloads are skipped.
      if (rowsByTable) this.addIfNotExist(rowsByTable)
      // The resolver expands a relation item into its bare row, so resolving the
      // fetched items also resolves any bare rows we subsumed into them.
      this.resolve({ items, success: rowsByTable !== undefined })
    } catch {
      // Unblock waiters so a failed batch doesn't leave its requests hanging.
      this.resolve({ items, success: false })
    } finally {
      // Clear only this batch's keys; a concurrent flush may still own others.
      for (const [k] of entries) this.inflight.delete(k)
      this.publish()
    }
  }

  private publish(): void {
    this.batches.set({
      pending: mergeRequests([...this.pending.values()]),
      inflight: mergeRequests([...this.inflight.values()]),
    })
  }
}
