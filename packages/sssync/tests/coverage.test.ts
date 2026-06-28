import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { CoverageTracker } from '../src/coverage'
import { column, createSchema, table } from '../src/schema'
import { cacheKeyForItem, type ResolvedItem } from '../src/shared'

const status = (tracker: CoverageTracker, item: ResolvedItem) =>
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

const validRow = {
  id: '1',
  title: 'First',
  priority: 1,
  done: false,
  ownerId: null,
}

describe('CoverageTracker', () => {
  let restoreFetch: () => void

  function mockFetch(impl: (url: string) => Response | Promise<Response>) {
    const original = globalThis.fetch
    globalThis.fetch = mock(impl) as unknown as typeof fetch
    restoreFetch = () => {
      globalThis.fetch = original
    }
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
    const tracker = new CoverageTracker(schema, '/batch')

    const item = { modelName: 'issues', id: '1' }
    expect(status(tracker, item)).toBeUndefined()

    tracker.request(item)
    tracker.request({ modelName: 'issues', id: '1', relation: 'comments' })
    await tracker['batcher'].flush()

    expect(status(tracker, item)).toBe('success')
    expect(
      status(tracker, { modelName: 'issues', id: '1', relation: 'comments' }),
    ).toBe('success')
  })

  test('records error when validation fails', async () => {
    mockFetch(() => jsonResponse({ issues: [{ ...validRow, priority: 'x' }] }))
    const tracker = new CoverageTracker(schema, '/batch')

    const item = { modelName: 'issues', id: '1' }
    tracker.request(item)
    await tracker['batcher'].flush()

    expect(status(tracker, item)).toBe('error')
  })

  test('records error on a non-ok response', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const tracker = new CoverageTracker(schema, '/batch')

    const item = { modelName: 'issues', id: '1' }
    tracker.request(item)
    await tracker['batcher'].flush()

    expect(status(tracker, item)).toBe('error')
  })

  test('request resolves to success once the batch settles', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch')

    const pending = tracker.request({ modelName: 'issues', id: '1' })
    expect(pending).toBeInstanceOf(Promise)

    await tracker['batcher'].flush()
    expect(await pending).toBe('success')
  })

  test('request returns "success" synchronously when already covered', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch')
    const item = { modelName: 'issues', id: '1' }

    tracker.request(item)
    await tracker['batcher'].flush()

    expect(tracker.request(item)).toBe('success')
  })

  test('concurrent requests for the same item share one promise', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch')
    const item = { modelName: 'issues', id: '1' }

    const a = tracker.request(item)
    const b = tracker.request(item)
    expect(b).toBe(a)
  })

  test('a failed item is retried on the next request', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const tracker = new CoverageTracker(schema, '/batch')
    const item = { modelName: 'issues', id: '1' }

    const first = tracker.request(item)
    await tracker['batcher'].flush()
    expect(await first).toBe('error')
    expect(status(tracker, item)).toBe('error')

    // Server recovers; a new request retries rather than returning 'error'.
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const retry = tracker.request(item)
    expect(retry).toBeInstanceOf(Promise)

    await tracker['batcher'].flush()
    expect(await retry).toBe('success')
    expect(status(tracker, item)).toBe('success')
  })

  test('keys each item by model, id, and relation', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch')

    tracker.request({ modelName: 'issues', id: '1' })
    await tracker['batcher'].flush()

    // Same model+id but a different relation has not been covered.
    expect(status(tracker, { modelName: 'issues', id: '1' })).toBe('success')
    expect(
      status(tracker, { modelName: 'issues', id: '1', relation: 'owner' }),
    ).toBeUndefined()
  })
})
