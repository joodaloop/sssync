import type { QueryKey, QueryResult } from '../types'

export type QueryCacheOptions = {
  ttlMs?: number
}

export class QueryCache<Value> {
  private readonly cache = new Map<string, QueryResult<Value>>()
  private readonly ttlMs: number | null

  constructor(options: QueryCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? null
  }

  get(key: QueryKey, now = Date.now()): Value | null {
    const entry = this.cache.get(key.join('|'))
    if (!entry) {
      return null
    }

    if (this.ttlMs !== null && now - entry.updatedAt > this.ttlMs) {
      this.cache.delete(key.join('|'))
      return null
    }

    return entry.value
  }

  set(key: QueryKey, value: Value, now = Date.now()): void {
    this.cache.set(key.join('|'), { value, updatedAt: now })
  }

  invalidate(key: QueryKey): void {
    this.cache.delete(key.join('|'))
  }

  clear(): void {
    this.cache.clear()
  }
}
