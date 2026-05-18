import { describe, expect, test } from 'bun:test'
import { SSSync } from '../sssync/sssync'
import { mockEvents } from './mock-events'
import { mockProjectors } from './mock-projectors'
import { mockSchema } from './mock-schema'
import { createMockStore } from './mock-store'

function createSSSync() {
  const store = createMockStore()
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

  test('commit runs the matching projector and applies ops to the store', async () => {
    const { sss, store } = createSSSync()

    const result = await sss.commit.v2_postAdded({
      id: 'p1',
      content: 'hello',
      title: 'Hi',
    })

    expect(result.err).toBeNull()
    expect(result.data).toEqual([
      { type: 'add', table: 'posts', data: { id: 'p1', content: 'hello', title: 'Hi' } },
    ])
    expect(store.applied).toHaveLength(1)
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
      // @ts-expect-error — content is required
      content: 42,
    })

    expect(result.data).toBeNull()
    expect(result.err).toBeInstanceOf(Error)
    expect(store.applied).toHaveLength(0)
  })
})
