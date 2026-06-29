import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { CoverageTracker } from '../src/coverage'
import { column, createSchema, table } from '../src/schema'
import { type BatchStats, cacheKeyForItem, Observable, resolvedItemFor, type ResolvedItem } from '../src/shared'

const status = (tracker: CoverageTracker, item: ResolvedItem) => tracker.coverage.get(cacheKeyForItem(item))

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

    tracker.request(issue)
    tracker.request(item('1', 'comments'))
    await tracker['batcher'].flush()

    expect(status(tracker, issue)).toBe('success')
    expect(status(tracker, item('1', 'comments'))).toBe('success')
  })

  test('records error when validation fails', async () => {
    mockFetch(() => jsonResponse({ issues: [{ ...validRow, priority: 'x' }] }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())

    const issue = item('1')
    tracker.request(issue)
    await tracker['batcher'].flush()

    expect(status(tracker, issue)).toBe('error')
  })

  test('records error on a non-ok response', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const tracker = new CoverageTracker(schema, '/batch', batchStats())

    const issue = item('1')
    tracker.request(issue)
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

    tracker.request(issue)
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

    tracker.request(item('1'))
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
})
