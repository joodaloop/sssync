import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { CoverageTracker } from '../src/coverage'
import type { PersistenceError } from '../src/errors'
import type { IDBKVTransaction, IDBStorage } from '../src/idb/types'
import { column, createSchema, table } from '../src/schema'
import type { ClientDatabaseSchema } from '../src/schema'
import { cacheKeyForItem, Observable, resolvedItemFor } from '../src/shared'
import type { BatchStats, ResolvedItem } from '../src/shared'

const status = <S extends ClientDatabaseSchema>(tracker: CoverageTracker<S>, item: ResolvedItem) =>
  tracker.coverage.get(cacheKeyForItem(item))

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    priority: column.number(),
    done: column.boolean(),
    ownerId: column.string().optional(),
  })
  .primaryKey('id')

const schema = createSchema({ tables: [issues] })

const item = (id: string, relation?: string) =>
  resolvedItemFor(schema.tables.issues, {
    modelName: 'issues',
    id,
    relation,
  })

const validRow = {
  id: '1',
  title: 'First',
  priority: 1,
  done: false,
  ownerId: null,
}

const batchStats = () => new Observable<BatchStats>({ pending: [], inflight: [] })

function fakeStorage(
  initial: readonly [string, unknown][] = [],
  options: { readonly failGet?: boolean; readonly failPut?: boolean } = {},
) {
  const values = new Map<string, unknown>(initial)
  const puts: [string, unknown][] = []
  const kv: IDBKVTransaction = {
    async get(id) {
      if (options.failGet) throw new Error('kv get failed')
      return values.get(id)
    },
    async put(id, value) {
      if (options.failPut) throw new Error('kv put failed')
      puts.push([id, value])
      values.set(id, value)
    },
  }
  const storage: IDBStorage<typeof schema> = {
    __idbStorage: 'IDBStorage',
    init() {},
    async read() {
      throw new Error('read is not implemented for this test storage')
    },
    async transactionKVStore(callback) {
      return callback(kv)
    },
  }
  return { storage, values, puts }
}

const recordErrors = () => {
  const errors: PersistenceError[] = []
  return {
    errors,
    report(error: PersistenceError) {
      errors.push(error)
    },
  }
}

const coverageKVKey = (item: ResolvedItem) => `coverage:${cacheKeyForItem(item)}`

const settleStorageLookup = () => new Promise(resolve => setTimeout(resolve, 0))

describe('CoverageTracker', () => {
  let restoreFetch: () => void

  function mockFetch(impl: (url: string) => Response | Promise<Response>) {
    const original = globalThis.fetch
    const fetchMock = mock(impl)
    globalThis.fetch = fetchMock as unknown as typeof fetch
    restoreFetch = () => {
      globalThis.fetch = original
    }
    return fetchMock
  }

  function jsonResponse(body: unknown, init?: ResponseInit) {
    return new Response(JSON.stringify(body), init)
  }

  beforeEach(() => {
    restoreFetch = () => {}
  })

  afterEach(() => {
    restoreFetch()
  })

  test('records success for items in a resolved batch', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())

    const issue = item('1')
    expect(status(tracker, issue)).toBeUndefined()

    void tracker.request(issue)
    void tracker.request(item('1', 'comments'))
    await tracker['batcher'].flush()

    expect(status(tracker, issue)).toBe('success')
    expect(status(tracker, item('1', 'comments'))).toBe('success')
  })

  test('records error when validation fails', async () => {
    mockFetch(() => jsonResponse({ issues: [{ ...validRow, priority: 'x' }] }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())

    const issue = item('1')
    void tracker.request(issue)
    await tracker['batcher'].flush()

    expect(status(tracker, issue)).toBe('error')
  })

  test('records error on a non-ok response', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())

    const issue = item('1')
    void tracker.request(issue)
    await tracker['batcher'].flush()

    expect(status(tracker, issue)).toBe('error')
  })

  test('request resolves to success once the batch settles', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())

    const pending = tracker.request(item('1'))
    expect(pending).toBeInstanceOf(Promise)

    await tracker['batcher'].flush()
    expect(await pending).toBe('success')
  })

  test('request returns "success" synchronously when already covered', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())
    const issue = item('1')

    void tracker.request(issue)
    await tracker['batcher'].flush()

    expect(tracker.request(issue)).toBe('success')
  })

  test('concurrent requests for the same item share one promise', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())
    const issue = item('1')

    const a = tracker.request(issue)
    const b = tracker.request(issue)
    expect(b).toBe(a)
  })

  test('a failed item is retried on the next request', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())
    const issue = item('1')

    const first = tracker.request(issue)
    await tracker['batcher'].flush()
    expect(await first).toBe('error')
    expect(status(tracker, issue)).toBe('error')

    // Server recovers; a new request retries rather than returning 'error'.
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const retry = tracker.request(issue)
    expect(retry).toBeInstanceOf(Promise)

    await tracker['batcher'].flush()
    expect(await retry).toBe('success')
    expect(status(tracker, issue)).toBe('success')
  })

  test('keys each item by model, id, and relation', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())

    void tracker.request(item('1'))
    await tracker['batcher'].flush()

    // Same model+id but a different relation has not been covered.
    expect(status(tracker, item('1'))).toBe('success')
    expect(status(tracker, item('1', 'owner'))).toBeUndefined()
  })

  test('relation coverage also satisfies a pending bare-row request', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const fetchMock = mockFetch(async () => {
      await gate
      return jsonResponse({ issues: [validRow] })
    })
    const tracker = new CoverageTracker(schema, '/batch', batchStats())

    const relation = tracker.request(item('1', 'comments'))
    const flushed = tracker['batcher'].flush()
    const bare = tracker.request(item('1'))

    expect(bare).toBe(relation)

    release()
    await flushed

    expect(await bare).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(status(tracker, item('1'))).toBe('success')
    expect(status(tracker, item('1', 'comments'))).toBe('success')
  })

  test('bare-row coverage does not satisfy a relation request', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())

    const bare = tracker.request(item('1'))
    await tracker['batcher'].flush()
    expect(await bare).toBe('success')

    const relation = tracker.request(item('1', 'comments'))
    expect(relation).toBeInstanceOf(Promise)
    await tracker['batcher'].flush()

    expect(await relation).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('persists successful coverage to the kv store', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const { storage, values } = fakeStorage()
    const tracker = new CoverageTracker(schema, '/batch', batchStats(), undefined, storage)
    const issue = item('1')

    const result = tracker.request(issue)
    await settleStorageLookup()
    await tracker['batcher'].flush()
    expect(await result).toBe('success')
    await settleStorageLookup()

    expect(values.get(coverageKVKey(issue))).toBe('success')
  })

  test('does not persist failed coverage to the kv store', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const { storage, puts } = fakeStorage()
    const tracker = new CoverageTracker(schema, '/batch', batchStats(), undefined, storage)

    const result = tracker.request(item('1'))
    await settleStorageLookup()
    await tracker['batcher'].flush()
    expect(await result).toBe('error')
    await settleStorageLookup()

    expect(puts).toEqual([])
  })

  test('reports kv store read failures and falls back to fetching', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
    const { storage } = fakeStorage([], { failGet: true })
    const { errors, report } = recordErrors()
    const tracker = new CoverageTracker(schema, '/batch', batchStats(), undefined, storage, report)
    const issue = item('1')

    const result = tracker.request(issue)
    await settleStorageLookup()
    await tracker['batcher'].flush()

    expect(await result).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      type: 'persistence.read_failed',
      store: 'coverage',
      key: coverageKVKey(issue),
      cause: { message: 'Error: kv get failed' },
    })
  })

  test('reports kv store write failures without changing successful coverage', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const { storage } = fakeStorage([], { failPut: true })
    const { errors, report } = recordErrors()
    const tracker = new CoverageTracker(schema, '/batch', batchStats(), undefined, storage, report)

    const result = tracker.request(item('1'))
    await settleStorageLookup()
    await tracker['batcher'].flush()
    expect(await result).toBe('success')
    await settleStorageLookup()

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      type: 'persistence.write_failed',
      store: 'coverage',
      cause: { message: 'Error: kv put failed' },
    })
  })

  test('returns success from a persisted coverage match and updates memory', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
    const issue = item('1')
    const { storage } = fakeStorage([[coverageKVKey(issue), 'success']])
    const tracker = new CoverageTracker(schema, '/batch', batchStats(), undefined, storage)

    const result = tracker.request(issue)

    expect(result).toBeInstanceOf(Promise)
    expect(await result).toBe('success')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(status(tracker, issue)).toBe('success')
  })

  test('a persisted bare-row match does not satisfy a relation request', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
    const bare = item('1')
    const relation = item('1', 'comments')
    const { storage } = fakeStorage([[coverageKVKey(bare), 'success']])
    const tracker = new CoverageTracker(schema, '/batch', batchStats(), undefined, storage)

    const result = tracker.request(relation)
    expect(result).toBeInstanceOf(Promise)
    await settleStorageLookup()
    await tracker['batcher'].flush()

    expect(await result).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(status(tracker, relation)).toBe('success')
  })
})
