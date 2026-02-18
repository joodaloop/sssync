import 'fake-indexeddb/auto'
import { describe, expect, it } from 'bun:test'
import { createIndexedDbClient } from '../src/index'
describe('createIndexedDbClient', () => {

  it('creates object stores on upgrade', async () => {
    const client = createIndexedDbClient({
      name: 'event-store',
      version: 1,
      eventStoreName: 'events',
      cacheStoreName: 'cache'
    })

    const database = await client.open()
    const storeNames = Array.from(database.objectStoreNames)

    expect(storeNames).toContain('events')
    expect(storeNames).toContain('cache')
  })

  it('clears stores', async () => {
    const client = createIndexedDbClient({
      name: 'event-store',
      version: 1,
      eventStoreName: 'events',
      cacheStoreName: 'cache'
    })

    const database = await client.open()
    const transaction = database.transaction(['events', 'cache'], 'readwrite')
    transaction.objectStore('events').add({ id: '1', type: 'added' })
    transaction.objectStore('cache').add({ key: 'user|1', value: 'test' })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    await client.clear()

    const verifyTx = database.transaction(['events', 'cache'], 'readonly')
    const eventsStore = verifyTx.objectStore('events')
    const cacheStore = verifyTx.objectStore('cache')

    const [events, cache] = await Promise.all([
      eventsStore.getAll(),
      cacheStore.getAll()
    ])

    await new Promise<void>((resolve, reject) => {
      verifyTx.oncomplete = () => resolve()
      verifyTx.onerror = () => reject(verifyTx.error)
    })

    expect(events).toHaveLength(0)
    expect(cache).toHaveLength(0)
  })
})
