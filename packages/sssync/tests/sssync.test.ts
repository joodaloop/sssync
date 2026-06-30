import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { defineMutators } from '../src/mutators'
import { column, createSchema, table } from '../src/schema'
import { SSSync } from '../src/sss'

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
  })
  .primaryKey('id')

const schema = createSchema({ tables: [issues] })
const mutators = defineMutators(schema, () => ({}))

const validRow = {
  id: '1',
  title: 'First',
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), init)
}

function sync() {
  return new SSSync({
    name: 'test',
    id: 'test-user',
    schema,
    mutators,
    schemaVersion: 1,
    batchURL: 'https://example.test/batch',
    bootstrapURL: 'https://example.test/bootstrap',
    storage: null,
  })
}

describe('SSSync.bootstrapload', () => {
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

  beforeEach(() => {
    restoreFetch = () => {}
  })

  afterEach(() => {
    restoreFetch()
  })

  test('loads a table through the public API', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
    const db = sync()

    const rows = await db.bootstrapload('issues')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/bootstrap?model=issues')
    expect(rows).toEqual([validRow])
    expect(db.stats.bootstraps.get().issues?.status).toBe('success')
  })

  test('reports bootstrap errors through stats.errors', async () => {
    mockFetch(() => jsonResponse({}, { status: 500, statusText: 'Server Error' }))
    const db = sync()

    await db.bootstrapload('issues')

    expect(db.stats.errors.get()[0]).toEqual({
      type: 'bootstrap.http_failed',
      model: 'issues',
      response: {
        status: 500,
        statusText: 'Server Error',
        url: 'https://example.test/bootstrap?model=issues',
      },
    })
  })
})
