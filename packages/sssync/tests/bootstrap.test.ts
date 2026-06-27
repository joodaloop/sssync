import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  Bootstrap,
  type BootstrapStatus,
  type StatusChange,
} from '../src/bootstrap'
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

// Default satisfaction check: nothing has been bootstrapped yet.
const notSatisfied = async () => undefined

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
    const bootstrap = new Bootstrap(schema, '/bootstrap', notSatisfied, () => {})

    await bootstrap.load('issues')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/bootstrap?model=issues')
  })

  test('marks pending then success when all rows validate', async () => {
    mockFetch(() => jsonResponse({ data: [validRow] }))
    const changes: StatusChange[] = []
    const bootstrap = new Bootstrap(schema, '/bootstrap', notSatisfied, c =>
      changes.push(c),
    )

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
      const changes: StatusChange[] = []
      const bootstrap = new Bootstrap(
        schema,
        '/bootstrap',
        async () => existing,
        c => changes.push(c),
      )

      const rows = await bootstrap.load('issues')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(rows).toBeUndefined()
      expect(changes).toHaveLength(0)
      restoreFetch()
    }
  })

  test('checks satisfaction with the requested model name', async () => {
    mockFetch(() => jsonResponse({ data: [validRow] }))
    const checkStatus = mock(async () => undefined)
    const bootstrap = new Bootstrap(schema, '/bootstrap', checkStatus, () => {})

    await bootstrap.load('issues')

    expect(checkStatus).toHaveBeenCalledWith('issues')
  })

  test('marks error before fetching or checking for an unknown model', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [] }))
    const checkStatus = mock(async () => undefined)
    const changes: StatusChange[] = []
    const bootstrap = new Bootstrap(schema, '/bootstrap', checkStatus, c =>
      changes.push(c),
    )

    const rows = await bootstrap.load('widgets')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(checkStatus).not.toHaveBeenCalled()
    expect(rows).toBeUndefined()
    expect(changes).toHaveLength(1)
    expect(changes[0].status).toBe('error')
    expect(changes[0].error).toContain('widgets')
  })

  test('marks error with a message when a row fails validation', async () => {
    mockFetch(() => jsonResponse({ data: [{ ...validRow, priority: 'high' }] }))
    const changes: StatusChange[] = []
    const bootstrap = new Bootstrap(schema, '/bootstrap', notSatisfied, c =>
      changes.push(c),
    )

    const rows = await bootstrap.load('issues')

    expect(rows).toBeUndefined()
    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toBeTruthy()
  })

  test('marks error when the payload has no data array', async () => {
    mockFetch(() => jsonResponse({ rows: [validRow] }))
    const changes: StatusChange[] = []
    const bootstrap = new Bootstrap(schema, '/bootstrap', notSatisfied, c =>
      changes.push(c),
    )

    await bootstrap.load('issues')

    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toContain('data')
  })

  test('marks error on a non-ok response', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const changes: StatusChange[] = []
    const bootstrap = new Bootstrap(schema, '/bootstrap', notSatisfied, c =>
      changes.push(c),
    )

    await bootstrap.load('issues')

    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toContain('500')
  })
})
