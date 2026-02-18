import 'fake-indexeddb/auto'
import { describe, expect, it } from 'bun:test'
import * as v from 'valibot'
import { Events, SSSync, type MaterializerMap } from '../src/index'
import { mock } from 'bun:test'

describe('SSSync', () => {
  it('materializes events into tables and caches queries', async () => {
    const events = {
      pageCreated: Events.define({
        name: 'pageCreated',
        schema: v.object({
          id: v.string(),
          title: v.string()
        })
      })
    }

    const tableSchemas = {
      pages: v.object({ id: v.string(), title: v.string() })
    }

    const materializers: MaterializerMap<typeof tableSchemas, typeof events> = {
      pageCreated: payload => [
        {
          type: 'create',
          tableName: 'pages',
          value: { id: payload.id, title: payload.title }
        }
      ]
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          mode: 'snapshot',
          data: { pages: [{ id: 'page-1', title: 'Hello' }] }
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch

    const client = new SSSync('client-1', events, materializers, tableSchemas)

    await client.commit([
      {
        id: 'event-1',
        name: 'pageCreated',
        payload: { id: 'page-1', title: 'Hello' },
        timestamp: 1
      }
    ])

    expect(client.tables.pages).toHaveLength(1)

    const response = await client.query('/pages')
    expect(response.mode).toBe('snapshot')
    globalThis.fetch = originalFetch
  })
})
