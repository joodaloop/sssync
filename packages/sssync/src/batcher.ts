import { Result } from 'better-result'

import type { ClientDatabaseSchema } from './schema/table-schema'
import { cacheKeyForItem, rowKeyForItem } from './shared'
import type { BatchStats, MergedRequest, Observable, ResolvedItem } from './shared'
import type { RowsByTable } from './store'
import type { RowValidationProblem } from './validate'

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
  timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly batchURL: string,
    private readonly batches: Observable<BatchStats>,
    private readonly validatePayload: (payload: unknown) => Result<RowsByTable<S>, RowValidationProblem>,
    private readonly addIfNotExist: (rowsByTable: RowsByTable<S>) => void,
    private readonly resolve: (batch: ResolvedBatch) => void,
  ) {}

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
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify(mergeRequests(items)),
      })
      if (!res.ok) {
        throw new Error(`Batch fetch failed: ${res.status} ${res.statusText}`)
      }
      // Only report success if every incoming row passes its write schema.
      const payload = await res.json()
      const rowsByTable = this.validatePayload(payload)
      if (Result.isError(rowsByTable)) {
        console.warn(messageFor(rowsByTable.error))
      }
      // Seed the validated rows into the store before resolving, so waiters see
      // the data the moment their request settles. Invalid payloads are skipped.
      if (Result.isOk(rowsByTable)) this.addIfNotExist(rowsByTable.value)
      // The resolver expands a relation item into its bare row, so resolving the
      // fetched items also resolves any bare rows we subsumed into them.
      this.resolve({ items, success: Result.isOk(rowsByTable) })
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

function messageFor(problem: RowValidationProblem): string {
  switch (problem.type) {
    case 'payload_not_object':
      return 'Batch response was not an object of rows'
    case 'unknown_model':
      return `Batch response referenced unknown table "${problem.model}"`
    case 'rows_not_array':
      return `Rows for table "${problem.model}" were not an array`
    case 'invalid_row':
      return `Invalid "${problem.model}" row: ${problem.issues.map(issue => issue.message).join('; ')}`
  }
}
