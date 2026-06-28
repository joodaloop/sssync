import { Batcher, type ResolvedBatch } from '../batcher'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import { cacheKeyForItem, type ResolvedItem } from '../shared'

export type Coverage = 'success' | 'error'

// Tracks which items have been fetched by driving a Batcher and recording the
// outcome of each resolved item keyed by its cache key.
export class CoverageTracker {
  readonly coverage = new Map<string, Coverage>()
  private readonly batcher: Batcher

  constructor(schema: ClientDatabaseSchema, batchURL: string) {
    this.batcher = new Batcher(schema, batchURL, this.resolveItems)
  }

  // Queues an item to be fetched. Mirrors `Batcher.request`.
  request(item: ResolvedItem) {
    this.batcher.request(item)
  }

  // The current coverage of `item`, or undefined if it hasn't resolved yet.
  statusOf(item: ResolvedItem): Coverage | undefined {
    return this.coverage.get(cacheKeyForItem(item))
  }

  // Handed to the batcher as its resolver; records each item's outcome.
  private resolveItems = (batch: ResolvedBatch) => {
    const result: Coverage = batch.success ? 'success' : 'error'
    for (const item of batch.items) {
      this.coverage.set(cacheKeyForItem(item), result)
    }
  }
}
