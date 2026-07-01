import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { Bootstrap } from '../src/bootstrap'
import type { BootstrapsSnapshot, StatusChange } from '../src/bootstrap'
import { column, createSchema, table } from '../src/schema'
import { Observable, type LoadingStatus } from '../src/shared'
import type { ReporterFactory } from '../src/sss'
import type { RowsByTable } from '../src/store'
import { rowValidatorsFor, validateRowsByTable } from '../src/validate'

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
const validators = rowValidatorsFor(schema)
const validatePayload = (payload: unknown) => validateRowsByTable<typeof schema>(payload, validators)

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

// Builds a Bootstrap with test defaults for the cross-tab/persistence args:
// a unique channel id (so tests don't share a BroadcastChannel) and no storage.
let dbCounter = 0
function makeBootstrap(
  url: string,
  bootstraps: Observable<BootstrapsSnapshot<typeof schema>>,
  validate: typeof validatePayload,
  addIfNotExist: (rowsByTable: RowsByTable<typeof schema>) => void,
  reporterFor: ReporterFactory,
): Bootstrap<typeof schema> {
  return new Bootstrap(
    url,
    bootstraps,
    validate,
    addIfNotExist,
    reporterFor,
    `test-db-${dbCounter++}`,
    null,
    Object.keys(schema.tables),
  )
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
    const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
    const bootstrap = makeBootstrap('/bootstrap', bootstrapRegistry(), validatePayload, () => {}, () => () => {})

    await bootstrap.load('issues')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/bootstrap?model=issues')
  })

  test('marks pending then success when all rows validate', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const bootstrap = makeBootstrap('/bootstrap', bootstraps, validatePayload, () => {}, () => () => {})

    const rows = await bootstrap.load('issues')

    expect(changes).toEqual([
      { name: 'issues', status: 'pending' },
      { name: 'issues', status: 'success' },
    ])
    expect(rows).toEqual([validRow])
  })

  test('adds validated rows to the store by table name', async () => {
    mockFetch(() => jsonResponse({ issues: [{ ...validRow, ignored: 'server-only' }] }))
    const added: unknown[] = []
    const bootstrap = makeBootstrap('/bootstrap', bootstrapRegistry(), validatePayload, rowsByTable => {
      added.push(rowsByTable)
    }, () => () => {})

    await bootstrap.load('issues')

    expect(added).toEqual([{ issues: [validRow] }])
  })

  test('skips fetch when already satisfied or in flight', async () => {
    for (const existing of ['success', 'pending'] as LoadingStatus[]) {
      const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
      const bootstraps = bootstrapRegistry()
      bootstraps.set({ issues: { status: existing } })
      const changes = recordChanges(bootstraps)
      const bootstrap = makeBootstrap('/bootstrap', bootstraps, validatePayload, () => {}, () => () => {})

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
      return jsonResponse({ issues: [validRow] })
    })
    const bootstrap = makeBootstrap('/bootstrap', bootstrapRegistry(), validatePayload, () => {}, () => () => {})

    const a = bootstrap.load('issues')
    const b = bootstrap.load('issues')

    release()
    const [rowsA, rowsB] = await Promise.all([a, b])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(rowsA).toEqual([validRow])
    expect(rowsB).toBe(rowsA)
  })

  test('a fresh load after one succeeds is skipped by the registry', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
    const bootstrap = makeBootstrap('/bootstrap', bootstrapRegistry(), validatePayload, () => {}, () => () => {})

    await bootstrap.load('issues')
    await bootstrap.load('issues')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('checks satisfaction with the requested model name', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ issues: [validRow] }))
    const bootstraps = bootstrapRegistry()
    bootstraps.set({ issues: { status: 'success' } })
    const bootstrap = makeBootstrap('/bootstrap', bootstraps, validatePayload, () => {}, () => () => {})

    await bootstrap.load('issues')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(bootstraps.get().issues?.status).toBe('success')
  })

  test('marks error when the response references an unknown model', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ widgets: [] }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const reports: unknown[] = []
    const bootstrap = makeBootstrap('/bootstrap', bootstraps, validatePayload, () => {}, where => error => {
      reports.push({ ...error, where })
    })

    const rows = await bootstrap.load('widgets')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(rows).toBeUndefined()
    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toBe('validation')
    expect(reports).toEqual([{ type: 'validation', where: 'bootstrap', offending: 'widgets' }])
  })

  test('marks error with a message when a row fails validation', async () => {
    mockFetch(() => jsonResponse({ issues: [{ ...validRow, priority: 'high' }] }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const added: unknown[] = []
    const reports: unknown[] = []
    const bootstrap = makeBootstrap(
      '/bootstrap',
      bootstraps,
      validatePayload,
      rowsByTable => {
        added.push(rowsByTable)
      },
      where => error => {
        reports.push({ ...error, where })
      },
    )

    const rows = await bootstrap.load('issues')

    expect(rows).toBeUndefined()
    expect(added).toEqual([])
    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toBe('validation')
    expect(reports).toEqual([
      { type: 'validation', where: 'bootstrap', offending: { ...validRow, priority: 'high' } },
    ])
  })

  test('marks error when a table payload is not an array', async () => {
    mockFetch(() => jsonResponse({ issues: { id: '1' } }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const bootstrap = makeBootstrap('/bootstrap', bootstraps, validatePayload, () => {}, () => () => {})

    await bootstrap.load('issues')

    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toBe('validation')
  })

  test('marks error on a non-ok response', async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const bootstraps = bootstrapRegistry()
    const changes = recordChanges(bootstraps)
    const bootstrap = makeBootstrap('/bootstrap', bootstraps, validatePayload, () => {}, () => () => {})

    await bootstrap.load('issues')

    expect(changes.map(c => c.status)).toEqual(['pending', 'error'])
    expect(changes[1].error).toBe('http')
  })
})
