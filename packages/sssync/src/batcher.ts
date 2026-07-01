import { Result } from 'better-result'

import { fetchJSON } from './better'
import type { Report, Reported } from './better'
import type { ClientDatabaseSchema } from './schema/table-schema'
import { cacheKeyForItem, rowKeyForItem } from './shared'
import type { BatchStats, MergedRequest, Observable, ResolvedItem } from './shared'
import type { RowsByTable } from './store'
import type { ValidatePayload } from './validate'

export type ResolvedBatch = {
  readonly items: readonly ResolvedItem[]
  readonly success: boolean
}

type Reporter = (error: Reported) => void

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
    private readonly validatePayload: ValidatePayload<S>,
    private readonly addIfNotExist: (rowsByTable: RowsByTable<S>) => void,
    private readonly resolve: (batch: ResolvedBatch) => void,
    private readonly report: Reporter = () => {},
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

    const rowsByTable = await Result.gen(async function* () {
      const payload = yield* Result.await(this.fetchBatch(items))

      // Only report success if every incoming row passes its write schema.
      return this.validatePayload(payload)
    }, this)

    // Clear only this batch's keys; a concurrent flush may still own others.
    for (const [k] of entries) this.inflight.delete(k)
    this.publish()

    rowsByTable.match({
      ok: rows => {
        // Seed the validated rows into the store before resolving, so waiters
        // see the data the moment their request settles.
        this.addIfNotExist(rows)
        // The resolver expands a relation item into its bare row, so resolving
        // the fetched items also resolves any bare rows we subsumed into them.
        this.resolve({ items, success: true })
      },
      err: error => {
        this.report({ ...error, where: 'batcher' })
        // Unblock waiters so a failed batch doesn't leave its requests hanging.
        this.resolve({ items, success: false })
      },
    })
  }

  private async fetchBatch(items: readonly ResolvedItem[]): Promise<Result<unknown, Report>> {
    return fetchJSON(this.batchURL, {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(mergeRequests(items)),
    })
  }

  private publish(): void {
    this.batches.set({
      pending: mergeRequests([...this.pending.values()]),
      inflight: mergeRequests([...this.inflight.values()]),
    })
  }
}
