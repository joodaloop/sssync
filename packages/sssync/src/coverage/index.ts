import { Batcher } from '../batcher'
import type { ResolvedBatch } from '../batcher'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import { cacheKeyForItem, coveredKeysForItem } from '../shared'
import type { BatchResponse, BatchStats, Observable, ResolvedItem } from '../shared'

export type Coverage = 'success' | 'error'

type Pending = {
  readonly promise: Promise<Coverage>
  readonly resolve: (coverage: Coverage) => void
}

// Tracks which items have been fetched by driving a Batcher and recording the
// outcome of each resolved item keyed by its cache key.
export class CoverageTracker {
  readonly coverage = new Map<string, Coverage>()
  // In-flight requests keyed by cache key, settled when the batcher resolves.
  private readonly pending = new Map<string, Pending>()
  private readonly batcher: Batcher

  constructor(
    schema: ClientDatabaseSchema,
    batchURL: string,
    batches: Observable<BatchStats>,
    addIfNotExist: (response: BatchResponse) => void = () => {},
  ) {
    this.batcher = new Batcher(schema, batchURL, batches, addIfNotExist, this.resolveItems)
  }

  // Requests coverage for `item`:
  // - returns 'success' synchronously if already covered,
  // - returns the in-flight promise if a request (or retry) is underway,
  // - otherwise fetches — a fresh item, or a retry of a prior 'error' — and
  //   returns a promise resolving to the outcome.
  request(item: ResolvedItem): Coverage | Promise<Coverage> {
    const key = cacheKeyForItem(item)

    if (this.coverage.get(key) === 'success') return 'success'

    const inflight = this.pending.get(key)
    if (inflight) return inflight.promise

    let resolve!: (coverage: Coverage) => void
    const promise = new Promise<Coverage>(res => {
      resolve = res
    })
    const pending = { promise, resolve }
    for (const coveredKey of coveredKeysForItem(item)) {
      if (!this.pending.has(coveredKey)) {
        this.pending.set(coveredKey, pending)
      }
    }
    this.batcher.request(item)
    return promise
  }

  // Handed to the batcher as its resolver; records each item's outcome and
  // settles any promise waiting on it.
  private resolveItems = (batch: ResolvedBatch) => {
    const result: Coverage = batch.success ? 'success' : 'error'
    for (const item of batch.items) {
      for (const key of coveredKeysForItem(item)) {
        this.coverage.set(key, result)
        const pending = this.pending.get(key)
        if (pending) {
          this.pending.delete(key)
          pending.resolve(result)
        }
      }
    }
  }
}
