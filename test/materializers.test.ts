import 'fake-indexeddb/auto'
import { describe, expect, it } from 'bun:test'
import { Events, SSSync, type MaterializerMap } from '../src/index'
import * as v from 'valibot'

describe('materializers', () => {
  it('validates payloads and applies materializers in SSSync', async () => {
    const events = {
      todoCreated: Events.define({
        name: 'todoCreated',
        schema: v.object({
          id: v.string(),
          text: v.string(),
          completed: v.optional(v.boolean())
        })
      }),
      userPreferencesUpdated: Events.define({
        name: 'userPreferencesUpdated',
        schema: v.object({
          userId: v.string(),
          theme: v.string()
        })
      }),
      todoCompleted: Events.define({
        name: 'todoCompleted',
        schema: v.object({
          id: v.string(),
          completed: v.boolean()
        })
      })
    }

    const tableSchemas = {
      todos: v.object({
        id: v.string(),
        text: v.string(),
        completed: v.boolean()
      }),
      preferences: v.object({
        id: v.string(),
        userId: v.string(),
        theme: v.string()
      })
    }

    const materializers: MaterializerMap<typeof tableSchemas, typeof events> = {
      todoCreated: payload => [
        {
          type: 'create',
          tableName: 'todos',
          value: {
            id: payload.id,
            text: payload.text,
            completed: payload.completed ?? false
          }
        }
      ],
      userPreferencesUpdated: payload => [
        {
          type: 'create',
          tableName: 'preferences',
          value: {
            id: payload.userId,
            userId: payload.userId,
            theme: payload.theme
          }
        }
      ],
      todoCompleted: payload => [
        {
          type: 'update',
          tableName: 'todos',
          value: { id: payload.id, completed: payload.completed }
        }
      ]
    }

    const client = new SSSync('materializer-test', events, materializers, tableSchemas)

    await client.commit([
      {
        id: '1',
        name: 'todoCreated',
        payload: { id: 'todo-1', text: 'Ship this', completed: true },
        timestamp: 100
      },
      {
        id: '2',
        name: 'userPreferencesUpdated',
        payload: { userId: 'user-1', theme: 'dark' },
        timestamp: 110
      }
    ])

    expect(client.tables.todos).toHaveLength(1)
    expect(client.tables.preferences).toHaveLength(1)

    await client.commit([
      {
        id: '3',
        name: 'todoCompleted',
        payload: { id: 'todo-1', completed: false },
        timestamp: 120
      }
    ])

    expect(client.tables.todos).toHaveLength(1)
    expect(client.tables.todos[0]?.completed).toBe(false)
    expect(client.tables.preferences).toHaveLength(1)
  })
})
