import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { Bootstrap, bootstrapKVKey } from '../src/bootstrap'
import type { BootstrapsSnapshot } from '../src/bootstrap'
import type { IDBStorage } from '../src/idb/types'
import { Observable } from '../src/shared'
import type { ReporterFactory } from '../src/sss'
import type { RowsByTable } from '../src/store'
import { fakeStorage, settleAsyncWork, validatePayload, validRow } from './fixtures/schema'
import type { Schema } from './fixtures/schema'

function makeBootstrap(
  options: {
    readonly storage?: IDBStorage<Schema> | null
    readonly reporterFor?: ReporterFactory
    readonly addToStore?: (rows: RowsByTable<Schema>) => void
    readonly url?: string
  } = {},
) {
  const statuses = new Observable<BootstrapsSnapshot<Schema>>({})
  const added: RowsByTable<Schema>[] = []
  const bootstrap = new Bootstrap(
    options.url ?? '/bootstrap',
    statuses,
    validatePayload,
    rows => {
      added.push(rows)
      options.addToStore?.(rows)
    },
    options.reporterFor ?? (() => () => {}),
    'test-sssync-id',
    options.storage ?? null,
    ['issues'],
  )
  return { bootstrap, statuses, added }
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

  // Docstring: "On initialisation: Load successes for all `tableNames` from
  // IDBStorage's KVStore and write to `this.bootstrapStatuses`".
  test('hydrate loads persisted successes from the kv store into bootstrapStatuses', async () => {
    const { storage } = fakeStorage([[bootstrapKVKey('issues'), 'success']])
    const { bootstrap, statuses } = makeBootstrap({ storage })

    expect(statuses.get().issues).toBeUndefined()

    await bootstrap.hydrate()

    expect(statuses.get().issues).toBe('success')
  })

  test('hydrate persists server-seeded successes when storage is available', async () => {
    const { storage, values, puts } = fakeStorage()
    const { bootstrap, statuses } = makeBootstrap({ storage })

    await bootstrap.hydrate(['issues'])

    expect(statuses.get().issues).toBe('success')
    expect(values.get(bootstrapKVKey('issues'))).toBe('success')
    expect(puts).toEqual([[bootstrapKVKey('issues'), 'success']])
  })

  // Docstring: "On initialisation: Set up listener on
  // `bootstrap-broadcast-channel` to trigger rescans of bootstrap successes".
  test('a broadcast-channel message triggers a rescan of the persisted status', async () => {
    // Persisted success exists, but this instance has not hydrated it — only a
    // rescan (driven by the broadcast) should surface it.
    const { storage } = fakeStorage([[bootstrapKVKey('issues'), 'success']])
    const { bootstrap, statuses } = makeBootstrap({ storage })

    expect(statuses.get().issues).toBeUndefined()

    // Simulate another tab announcing it just bootstrapped 'issues'. The channel
    // wraps payloads in a `{ senderId, message }` envelope and drops messages
    // from its own instance, so we post from a separate BroadcastChannel.
    const otherTab = new BroadcastChannel('sssync:test-sssync-id:bootstrap')
    otherTab.postMessage({ senderId: 'other-tab', message: { id: 'issues' } })

    await settleAsyncWork() // deliver the message
    await settleAsyncWork() // let the async rescan's storage read settle

    expect(statuses.get().issues).toBe('success')

    otherTab.close()
    bootstrap.close()
  })

  // Docstring: "make a fetch request to BootstrapURL?model=tableName and set
  // `this.bootstrapStatuses[tableName]` to 'pending'" ... then 'success'.
  test('load sets status to "pending" while the fetch is in flight, then "success"', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const fetchMock = mockFetch(async () => {
      await gate
      return jsonResponse({ issues: [validRow] })
    })
    const { bootstrap, statuses } = makeBootstrap()

    const loaded = bootstrap.load('issues')

    // Fetches `BootstrapURL?model=tableName`.
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/bootstrap?model=issues')

    // `pending` is set synchronously, before the fetch is awaited.
    expect(statuses.get().issues).toBe('pending')

    // A second load while still pending reuses the in-flight bootstrap.
    await bootstrap.load('issues')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    release()
    await loaded

    expect(statuses.get().issues).toBe('success')

    // A third load once settled to success also short-circuits — still no fetch.
    await bootstrap.load('issues')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // Docstring SUCCEEDS: "Call .addToStoreIfNotExist()", persist the success, and
  // "Notify other tabs through the `bootstrap-broadcast-channel`".
  test('a successful load adds rows to the store, persists, and notifies other tabs', async () => {
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    const { storage, values } = fakeStorage()
    const { bootstrap, statuses, added } = makeBootstrap({ storage })

    // Listen on the channel from a separate instance to catch the broadcast.
    const otherTab = new BroadcastChannel('sssync:test-sssync-id:bootstrap')
    const messages: unknown[] = []
    otherTab.addEventListener('message', event => messages.push((event as MessageEvent).data))

    await bootstrap.load('issues')

    expect(statuses.get().issues).toBe('success')
    // Rows handed to the store.
    expect(added).toEqual([{ issues: [validRow] }])
    // Success persisted to the kv store.
    expect(values.get(bootstrapKVKey('issues'))).toBe('success')

    // Broadcast to other tabs.
    await settleAsyncWork()
    expect(messages).toEqual([{ senderId: expect.any(String), message: { id: 'issues' } }])

    otherTab.close()
    bootstrap.close()
  })

  // Docstring FAILS: "Set `this.bootstrapStatuses[tableName]` to the
  // corresponding Failure" — both fetch and validation failures.
  test('a failed load sets the status to the corresponding Failure', async () => {
    // Non-ok HTTP response → http Failure, and nothing is persisted.
    mockFetch(() => jsonResponse({}, { status: 500 }))
    const { storage, puts } = fakeStorage()
    const http = makeBootstrap({ storage })

    await http.bootstrap.load('issues')
    expect(http.statuses.get().issues).toMatchObject({ type: 'http' })
    expect(http.added).toEqual([])
    expect(puts).toEqual([])

    // Malformed payload → validation Failure.
    mockFetch(() => jsonResponse({ issues: [{ ...validRow, priority: 'nope' }] }))
    const invalid = makeBootstrap()

    await invalid.bootstrap.load('issues')
    expect(invalid.statuses.get().issues).toMatchObject({ type: 'validation' })
    expect(invalid.added).toEqual([])
  })

  // A Failure status is neither 'success' nor 'pending', so the next `load`
  // re-fetches rather than short-circuiting.
  test('a failed load can be retried on the next call', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}, { status: 500 }))
    const { bootstrap, statuses } = makeBootstrap()

    await bootstrap.load('issues')
    expect(statuses.get().issues).toMatchObject({ type: 'http' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Server recovers; retry re-fetches and reaches success.
    mockFetch(() => jsonResponse({ issues: [validRow] }))
    await bootstrap.load('issues')

    expect(statuses.get().issues).toBe('success')
  })
})
