import { Batcher } from './batcher'
import type { ResolvedBatch } from './batcher'
import { attemptAsync } from './result'
import type { IDBStorage } from './idb/types'
import type { ClientDatabaseSchema } from './schema/table-schema'
import { cacheKeyForItem, coveredKeysForItem } from './shared'
import type { BatchStats, Observable, ResolvedItem } from './shared'
import type { Reporter, ReporterFactory } from './sss'
import type { RowsByTable } from './store'
import type { ValidatePayload } from './validate'

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
  private readonly report: Reporter

  constructor(
    batchURL: string,
    batches: Observable<BatchStats>,
    validatePayload: ValidatePayload<S>,
    addIfNotExist: (rowsByTable: RowsByTable<S>) => void = () => {},
    reporterFor: ReporterFactory,
    private readonly storage: null | IDBStorage<S> = null,
  ) {
    this.report = reporterFor('coverage')
    this.batcher = new Batcher(batchURL, batches, validatePayload, addIfNotExist, this.resolveItems, reporterFor)
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
      void this.resolveFromStorage(item, pending).then(resolved => {
        if (!resolved) this.batcher.request(item)
      })
    } else {
      this.batcher.request(item)
    }
    return promise
  }

  private async resolveFromStorage(item: ResolvedItem, pending: Pending): Promise<boolean> {
    const storage = this.storage
    if (!storage) return false
    const key = cacheKeyForItem(item)

    const read = await attemptAsync(
      () => storage.transactionKVStore(kv => kv.get(coverageKVKey(key))),
      error => error,
    )
    if (!read.ok) {
      this.report({
        type: 'persistence',
        offending: { store: COVERAGE_KV_PREFIX, key: coverageKVKey(key), error: read.error },
      })
    }
    const match = read.ok ? read.value : undefined

    if (match === 'success') {
      for (const coveredKey of coveredKeysForItem(item)) {
        this.coverage.set(coveredKey, 'success')
        this.pending.delete(coveredKey)
      }
      pending.resolve('success')
      return true
    }

    return false
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
    const storage = this.storage
    if (!storage) return
    const result = await attemptAsync(
      () =>
        storage.transactionKVStore(async kv => {
          await Promise.all(keys.map(key => kv.put(coverageKVKey(key), 'success')))
        }),
      error => error,
    )
    if (!result.ok) {
      this.report({
        type: 'persistence',
        offending: { store: COVERAGE_KV_PREFIX, error: result.error },
      })
    }
  }
}

function coverageKVKey(key: string): string {
  return `${COVERAGE_KV_PREFIX}:${key}`
}
