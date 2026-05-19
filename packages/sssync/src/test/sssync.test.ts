import { describe, expect, test } from 'bun:test'
import { createMemoryStore } from '../../../store-memory/src'
import { SSSync } from '../sssync/sssync'
import { mockEvents } from './mock-events'
import { mockProjectors } from './mock-projectors'
import { mockSchema } from './mock-schema'

function createSSSync() {
  const store = createMemoryStore(mockSchema)
  const sss = new SSSync({
    schema: mockSchema,
    events: mockEvents,
    projectors: mockProjectors,
    loaders: {},
    store,
  })
  return { sss, store }
}

describe('SSSync', () => {
  test('instantiates with schema, events, projectors, loaders, store', () => {
    const { sss, store } = createSSSync()

    expect(sss.schema).toBe(mockSchema)
    expect(sss.events).toBe(mockEvents)
    expect(sss.projectors).toBe(mockProjectors)
    expect(sss.store).toBe(store)
  })

  test('commit runs the projector and writes to the memory store', async () => {
    const { sss, store } = createSSSync()

    const result = await sss.commit.v2_postAdded({
      id: 'p1',
      content: 'hello',
      title: 'Hi',
    })

    expect(result.err).toBeNull()
    expect(store.rows('posts')).toEqual([
      { id: 'p1', content: 'hello', title: 'Hi' },
    ])
  })

  test('v1_postAdded fills in default title via the projector', async () => {
    const { sss, store } = createSSSync()

    await sss.commit.v1_postAdded({ id: 'p2', content: 'body' })

    expect(store.rows('posts')).toEqual([
      { id: 'p2', content: 'body', title: 'Untitled' },
    ])
  })

  test('commit returns an error for unknown events', async () => {
    const { sss } = createSSSync()

    // @ts-expect-error — unknown event
    const result = await sss.commit.v9_nope({})
    expect(result.data).toBeNull()
    expect(result.err).toBeInstanceOf(Error)
  })

  test('commit returns an error when args fail validation', async () => {
    const { sss, store } = createSSSync()

    const result = await sss.commit.v1_postAdded({
      id: 'p1',
      // @ts-expect-error — content must be a string
      content: 42,
    })

    expect(result.data).toBeNull()
    expect(result.err).toBeInstanceOf(Error)
    expect(store.rows('posts')).toEqual([])
  })
})
