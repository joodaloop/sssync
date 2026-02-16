import 'fake-indexeddb/auto'
import { describe, expect, it } from 'bun:test'
import * as v from 'valibot'
import { Events, SSSync, type MaterializerMap } from '../src/index'

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

    let fetchCount = 0
    const first = await client.query('pages:list', () => {
      fetchCount += 1
      return client.tables.pages
    })

    const second = await client.query('pages:list', () => {
      fetchCount += 1
      return client.tables.pages
    })

    expect(first).toBe(second)
    expect(fetchCount).toBe(1)
  })
})
