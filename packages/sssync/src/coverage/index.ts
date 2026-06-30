import { Batcher } from '../batcher'
import type { ResolvedBatch } from '../batcher'
import type { IDBStorage } from '../idb/types'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import { cacheKeyForItem, coveredKeysForItem } from '../shared'
import type { BatchStats, Observable, ResolvedItem } from '../shared'
import type { RowsByTable } from '../store'

export type Coverage = 'success' | 'error'

type Pending = {
  readonly promise: Promise<Coverage>
  readonly resolve: (coverage: Coverage) => void
}

const COVERAGE_KV_PREFIX = 'coverage'


export class CoverageTracker<S extends ClientDatabaseSchema> {
  readonly coverage = new Map<string, Coverage>()

  private readonly pending = new Map<string, Pending>()
  private readonly batcher: Batcher<S>

  constructor(
    schema: S,
    batchURL: string,
    batches: Observable<BatchStats>,
    addIfNotExist: (rowsByTable: RowsByTable<S>) => void = () => {},
    private readonly storage: null | IDBStorage<S> = null,
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
    if (this.storage) {
      void this.resolveFromStorageOrRequest(item, pending)
    } else {
      this.batcher.request(item)
    }
    return promise
  }

  private async resolveFromStorageOrRequest(item: ResolvedItem, pending: Pending): Promise<void> {
    const key = cacheKeyForItem(item)

    try {
      const match = await this.storage?.transactionKVStore(kv => kv.get(coverageKVKey(key)))
      if (match === 'success') {
        for (const coveredKey of coveredKeysForItem(item)) {
          this.coverage.set(coveredKey, 'success')
          this.pending.delete(coveredKey)
        }
        pending.resolve('success')
        return
      }
    } catch {
      // Treat persistence as an optimization; a failed read falls back to the
      // network path so coverage can still be established.
    }

    this.batcher.request(item)
  }

  // Handed to the batcher as its resolver; records each item's outcome and
  // settles any promise waiting on it.
  private resolveItems = (batch: ResolvedBatch) => {
    const result: Coverage = batch.success ? 'success' : 'error'
    for (const item of batch.items) {
      const coveredKeys = coveredKeysForItem(item)
      for (const key of coveredKeys) {
        this.coverage.set(key, result)
        const pending = this.pending.get(key)
        if (pending) {
          this.pending.delete(key)
          pending.resolve(result)
        }
      }
      if (result === 'success') {
        void this.writeSuccessesToStorage(coveredKeys)
      }
    }
  }

  private async writeSuccessesToStorage(keys: readonly string[]): Promise<void> {
    try {
      await this.storage?.transactionKVStore(async kv => {
        await Promise.all(keys.map(key => kv.put(coverageKVKey(key), 'success')))
      })
    } catch {
      // A successful batch should remain successful even if persistence fails.
    }
  }
}

function coverageKVKey(key: string): string {
  return `${COVERAGE_KV_PREFIX}:${key}`
}
