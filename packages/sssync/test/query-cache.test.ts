import { describe, expect, it } from 'bun:test'
import { QueryCache } from '../src/index'

describe('QueryCache', () => {
  it('stores and retrieves cached entries', () => {
    const cache = new QueryCache<number>()
    cache.set(['user', 1], 42, 1000)

    expect(cache.get(['user', 1], 1000)).toBe(42)
  })

  it('evicts entries past ttl', () => {
    const cache = new QueryCache<number>({ ttlMs: 100 })
    cache.set(['user', 2], 99, 1000)

    expect(cache.get(['user', 2], 1200)).toBeNull()
  })

  it('invalidates entries', () => {
    const cache = new QueryCache<number>()
    cache.set(['user', 3], 7, 1000)
    cache.invalidate(['user', 3])

    expect(cache.get(['user', 3], 1000)).toBeNull()
  })
})
