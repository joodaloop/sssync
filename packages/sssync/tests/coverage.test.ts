import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { CoverageTracker } from '../src/coverage'
import { column, createSchema, table } from '../src/schema'

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
    expect(tracker.statusOf(item)).toBeUndefined()

    tracker.request(item)
    tracker.request({ modelName: 'issues', id: '1', relation: 'comments' })
    await tracker['batcher'].flush()

    expect(tracker.statusOf(item)).toBe('success')
    expect(
      tracker.statusOf({ modelName: 'issues', id: '1', relation: 'comments' }),
    ).toBe('success')
  })

  test('records error when validation fails', async () => {
    mockFetch(() => jsonResponse({ issues: [{ ...validRow, priority: 'x' }] }))
    const tracker = new CoverageTracker(schema, '/batch')

    const item = { modelName: 'issues', id: '1' }
    tracker.request(item)
    await tracker['batcher'].flush()

    expect(tracker.statusOf(item)).toBe('error')
  })

  test('records error on a non-ok response', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const tracker = new CoverageTracker(schema, '/batch')

    const item = { modelName: 'issues', id: '1' }
    tracker.request(item)
    await tracker['batcher'].flush()

    expect(tracker.statusOf(item)).toBe('error')
  })

  test('keys each item by model, id, and relation', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const tracker = new CoverageTracker(schema, '/batch')

    tracker.request({ modelName: 'issues', id: '1' })
    await tracker['batcher'].flush()

    // Same model+id but a different relation has not been covered.
    expect(tracker.statusOf({ modelName: 'issues', id: '1' })).toBe('success')
    expect(
      tracker.statusOf({ modelName: 'issues', id: '1', relation: 'owner' }),
    ).toBeUndefined()
  })
})
