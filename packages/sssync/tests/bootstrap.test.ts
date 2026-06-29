import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { Bootstrap } from '../src/bootstrap'
import type { BootstrapsSnapshot, BootstrapStatus, StatusChange } from '../src/bootstrap'
import { column, createSchema, table } from '../src/schema'
import { Observable } from '../src/shared'

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

function bootstrapRegistry() {
  return new Observable<BootstrapsSnapshot<typeof schema>>({})
}

function recordChanges(bootstraps: Observable<BootstrapsSnapshot<typeof schema>>): StatusChange[] {
  const changes: StatusChange[] = []
  bootstraps.subscribe(() => {
    const snapshot = bootstraps.get() as Record<string, Omit<StatusChange, 'name'> | undefined>
    for (const [name, state] of Object.entries(snapshot)) {
      if (state) changes.push({ name, ...state })
    }
  })
  return changes
}

describe('Bootstrap', () => {
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

  test('fetches GET /bootstrap?model=<name>', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [validRow] }))
    const bootstrap = new Bootstrap(schema, '/bootstrap', bootstrapRegistry())

    await bootstrap.load('issues')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/bootstrap?model=issues')
  })

  test('marks pending then success when all rows validate', async () => {
    mockFetch(() => jsonResponse({ data: [validRow] }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const bootstrap = new Bootstrap(schema, '/bootstrap', bootstraps)

    const rows = await bootstrap.load('issues')

    expect(changes).toEqual([
      { name: 'issues', status: 'pending' },
      { name: 'issues', status: 'success' },
    ])
    expect(rows).toEqual([validRow])
  })

  test('skips fetch when already satisfied or in flight', async () => {
    for (const existing of ['success', 'pending'] as BootstrapStatus[]) {
      const fetchMock = mockFetch(() => jsonResponse({ data: [validRow] }))
      const bootstraps = bootstrapRegistry()
      bootstraps.set({ issues: { status: existing } })
      const changes = recordChanges(bootstraps)
      const bootstrap = new Bootstrap(schema, '/bootstrap', bootstraps)

      const rows = await bootstrap.load('issues')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(rows).toBeUndefined()
      expect(changes).toHaveLength(0)
      restoreFetch()
    }
  })

  test('concurrent loads share one in-flight request and result', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const fetchMock = mockFetch(async () => {
      await gate
      return jsonResponse({ data: [validRow] })
    })
    const bootstrap = new Bootstrap(schema, '/bootstrap', bootstrapRegistry())

    const a = bootstrap.load('issues')
    const b = bootstrap.load('issues')

    release()
    const [rowsA, rowsB] = await Promise.all([a, b])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(rowsA).toEqual([validRow])
    expect(rowsB).toBe(rowsA)
  })

  test('a fresh load after one succeeds is skipped by the registry', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [validRow] }))
    const bootstrap = new Bootstrap(schema, '/bootstrap', bootstrapRegistry())

    await bootstrap.load('issues')
    await bootstrap.load('issues')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('checks satisfaction with the requested model name', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [validRow] }))
    const bootstraps = bootstrapRegistry()
    bootstraps.set({ issues: { status: 'success' } })
    const bootstrap = new Bootstrap(schema, '/bootstrap', bootstraps)

    await bootstrap.load('issues')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(bootstraps.get().issues?.status).toBe('success')
  })

  test('marks error before fetching or checking for an unknown model', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [] }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const bootstrap = new Bootstrap(schema, '/bootstrap', bootstraps)

    const rows = await bootstrap.load('widgets')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(rows).toBeUndefined()
    expect(changes).toHaveLength(1)
    expect(changes[0].status).toBe('error')
    expect(changes[0].error).toContain('widgets')
  })

  test('marks error with a message when a row fails validation', async () => {
    mockFetch(() => jsonResponse({ data: [{ ...validRow, priority: 'high' }] }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const bootstrap = new Bootstrap(schema, '/bootstrap', bootstraps)

    const rows = await bootstrap.load('issues')

    expect(rows).toBeUndefined()
    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toBeTruthy()
  })

  test('marks error when the payload has no data array', async () => {
    mockFetch(() => jsonResponse({ rows: [validRow] }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const bootstrap = new Bootstrap(schema, '/bootstrap', bootstraps)

    await bootstrap.load('issues')

    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toContain('data')
  })

  test('marks error on a non-ok response', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const bootstrap = new Bootstrap(schema, '/bootstrap', bootstraps)

    await bootstrap.load('issues')

    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toContain('500')
  })
})
