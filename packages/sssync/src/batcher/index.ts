import { safeValidate } from '../json-validator'
import { rowSchemaFor } from '../schema/row-schema'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import { cacheKeyForItem, rowKeyForItem } from '../shared'
import type { BatchStats, MergedRequest, Observable, ResolvedItem } from '../shared'

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

export class Batcher {
  readonly wait = 100
  private readonly inflight = new Map<string, ResolvedItem>()
  private readonly pending = new Map<string, ResolvedItem>()
  // One row validator per table, derived from the schema's write columns.
  private readonly rowValidators: Record<string, ReturnType<typeof rowSchemaFor>>
  timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly schema: ClientDatabaseSchema,
    private readonly batchURL: string,
    private readonly batches: Observable<BatchStats>,
    private readonly resolve: (batch: ResolvedBatch) => void,
  ) {
    this.rowValidators = Object.fromEntries(
      Object.entries(schema.tables).map(([name, table]) => [name, rowSchemaFor(table)]),
    )
  }

  // Validates the server payload of `{ modelName: rows }` against each table's
  // write schema. Returns false on an unknown model or any invalid row.
  private validatePayload(payload: unknown): boolean {
    if (payload === null || typeof payload !== 'object') {
      console.warn('Batch response was not an object of rows')
      return false
    }

    for (const [modelName, rows] of Object.entries(payload)) {
      const validator = this.rowValidators[modelName]
      if (!validator) {
        console.warn(`Batch response referenced unknown model "${modelName}"`)
        return false
      }
      if (!Array.isArray(rows)) {
        console.warn(`Rows for model "${modelName}" were not an array`)
        return false
      }
      for (const row of rows) {
        const result = safeValidate(validator, row)
        if (!result.success) {
          const message = result.issues.map(issue => issue.message).join('; ')
          console.warn(`Invalid "${modelName}" row: ${message}`)
          return false
        }
      }
    }

    return true
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
      const valid = this.validatePayload(await res.json())
      // The resolver expands a relation item into its bare row, so resolving the
      // fetched items also resolves any bare rows we subsumed into them.
      this.resolve({ items, success: valid })
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
