import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'

import { Batcher, mergeRequests, type ResolvedBatch } from '../src/batcher'
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

// A minimal valid row for the `issues` table.
const validRow = {
  id: '1',
  title: 'First',
  priority: 1,
  done: false,
  ownerId: null,
}

describe('mergeRequests', () => {
  test('collapses same model + id into one entry with all relations', () => {
    const merged = mergeRequests([
      { modelName: 'issues', id: '1' },
      { modelName: 'issues', id: '1', relation: 'comments' },
      { modelName: 'issues', id: '1', relation: 'owner' },
    ])

    expect(merged).toEqual([
      { modelName: 'issues', id: '1', relations: ['comments', 'owner'] },
    ])
  })

  test('keeps distinct models and ids separate', () => {
    const merged = mergeRequests([
      { modelName: 'issues', id: '1', relation: 'comments' },
      { modelName: 'issues', id: '2', relation: 'comments' },
      { modelName: 'users', id: '1', relation: 'issues' },
    ])

    expect(merged).toEqual([
      { modelName: 'issues', id: '1', relations: ['comments'] },
      { modelName: 'issues', id: '2', relations: ['comments'] },
      { modelName: 'users', id: '1', relations: ['issues'] },
    ])
  })

  test('dedupes a relation requested more than once', () => {
    const merged = mergeRequests([
      { modelName: 'issues', id: '1', relation: 'comments' },
      { modelName: 'issues', id: '1', relation: 'comments' },
    ])

    expect(merged).toEqual([
      { modelName: 'issues', id: '1', relations: ['comments'] },
    ])
  })

  test('a bare row yields an empty relations array', () => {
    expect(mergeRequests([{ modelName: 'issues', id: '1' }])).toEqual([
      { modelName: 'issues', id: '1', relations: [] },
    ])
  })
})

describe('Batcher', () => {
  let restoreFetch: () => void
  let warn: ReturnType<typeof spyOn>

  function mockFetch(
    impl: (url: string, init: RequestInit) => Response | Promise<Response>,
  ) {
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
    // validatePayload warns on rejection; silence it for clean test output.
    warn = spyOn(console, 'warn').mockImplementation(() => {})
    restoreFetch = () => {}
  })

  afterEach(() => {
    restoreFetch()
    warn.mockRestore()
  })

  test('request dedupes pending and inflight keys', () => {
    const batcher = new Batcher(schema, '/batch', () => {})

    batcher.request({ modelName: 'issues', id: '1' })
    batcher.request({ modelName: 'issues', id: '1' })
    batcher.request({ modelName: 'issues', id: '1', relation: 'comments' })
    expect(batcher.pending.size).toBe(2)

    // A key already inflight is not re-queued.
    batcher.inflight.add('issues***2')
    batcher.request({ modelName: 'issues', id: '2' })
    expect(batcher.pending.size).toBe(2)
  })

  test('flush posts merged requests to the batch URL', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
    const batcher = new Batcher(schema, '/batch', () => {})

    batcher.request({ modelName: 'issues', id: '1' })
    batcher.request({ modelName: 'issues', id: '1', relation: 'comments' })
    await batcher.flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/batch')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual([
      { modelName: 'issues', id: '1', relations: ['comments'] },
    ])
    expect(batcher.pending.size).toBe(0)
  })

  test('resolves success: true when every row validates', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const batches: ResolvedBatch[] = []
    const batcher = new Batcher(schema, '/batch', b => batches.push(b))

    batcher.request({ modelName: 'issues', id: '1' })
    await batcher.flush()

    expect(batches).toHaveLength(1)
    expect(batches[0].success).toBe(true)
    expect(batches[0].items).toEqual([{ modelName: 'issues', id: '1' }])
  })

  test('resolves success: false when a row fails its write schema', async () => {
    // `priority` should be a number.
    mockFetch(() =>
      jsonResponse({ issues: [{ ...validRow, priority: 'high' }] }),
    )
    const batches: ResolvedBatch[] = []
    const batcher = new Batcher(schema, '/batch', b => batches.push(b))

    batcher.request({ modelName: 'issues', id: '1' })
    await batcher.flush()

    expect(batches).toHaveLength(1)
    expect(batches[0].success).toBe(false)
  })

  test('resolves success: false for an unknown model', async () => {
    mockFetch(() => jsonResponse({ widgets: [validRow] }))
    const batches: ResolvedBatch[] = []
    const batcher = new Batcher(schema, '/batch', b => batches.push(b))

    batcher.request({ modelName: 'issues', id: '1' })
    await batcher.flush()

    expect(batches[0].success).toBe(false)
  })

  test('resolves success: false on a non-ok response', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const batches: ResolvedBatch[] = []
    const batcher = new Batcher(schema, '/batch', b => batches.push(b))

    batcher.request({ modelName: 'issues', id: '1' })
    await batcher.flush()

    expect(batches[0].success).toBe(false)
  })

  test('flush clears only its own inflight keys', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    mockFetch(async () => {
      await gate
      return jsonResponse({ issues: [validRow] })
    })
    const batcher = new Batcher(schema, '/batch', () => {})

    // A key owned by a concurrent batch that is still in flight.
    batcher.inflight.add('issues***other')

    batcher.request({ modelName: 'issues', id: '1' })
    const flushed = batcher.flush()
    expect(batcher.inflight.has('issues***1')).toBe(true)

    release()
    await flushed

    // Our own key is cleared, the concurrent batch's key is left intact.
    expect(batcher.inflight.has('issues***1')).toBe(false)
    expect(batcher.inflight.has('issues***other')).toBe(true)
  })

  test('flush with nothing pending does not fetch', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}))
    const batcher = new Batcher(schema, '/batch', () => {})

    await batcher.flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
