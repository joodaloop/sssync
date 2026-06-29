import { describe, expect, test } from 'bun:test'

import type { Mutation } from '../src/mutators'
import { column, createSchema, table } from '../src/schema'
import { Store } from '../src/store'
import type { Insert } from '../src/store'

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    priority: column.number(),
    done: column.boolean(),
  })
  .primaryKey('id')

const schema = createSchema({ tables: [issues] })

type S = typeof schema

const row = (id: string, title: string): Insert<S> => ({
  type: 'INSERT',
  table: 'issues',
  data: { id, title, priority: 1, done: false },
})

describe('Store', () => {
  test('creates one Map per table', () => {
    const store = new Store(schema)
    expect(store.tables.issues).toBeInstanceOf(Map)
    expect(store.tables.issues.size).toBe(0)
  })

  test('stores INSERT rows keyed by primary key', () => {
    const store = new Store(schema)
    store.store([row('1', 'First'), row('2', 'Second')], true)

    expect(store.tables.issues.size).toBe(2)
    expect(store.tables.issues.get('["1"]')).toEqual({
      id: '1',
      title: 'First',
      priority: 1,
      done: false,
    })
  })

  test('UPDATE merges changes into an existing row', () => {
    const store = new Store(schema)
    store.store(
      [row('1', 'First'), { type: 'UPDATE', table: 'issues', id: { id: '1' }, changes: { done: true } }],
      false,
    )

    expect(store.tables.issues.get('["1"]')).toEqual({
      id: '1',
      title: 'First',
      priority: 1,
      done: true,
    })
  })

  test('UPDATE for a missing row is a no-op', () => {
    const store = new Store(schema)
    store.store([{ type: 'UPDATE', table: 'issues', id: { id: '99' }, changes: { done: true } }], false)

    expect(store.tables.issues.has('["99"]')).toBe(false)
  })

  test('DELETE removes the row', () => {
    const store = new Store(schema)
    store.store([row('1', 'First'), { type: 'DELETE', table: 'issues', id: { id: '1' } }], false)

    expect(store.tables.issues.has('["1"]')).toBe(false)
  })
})

describe('Store.addIfNotExist', () => {
  test('adds rows that are currently absent', () => {
    const store = new Store(schema)
    store.addIfNotExist([row('1', 'First'), row('2', 'Second')])

    expect(store.tables.issues.size).toBe(2)
    expect(store.tables.issues.get('["1"]')).toEqual({
      id: '1',
      title: 'First',
      priority: 1,
      done: false,
    })
  })

  test('does not clobber an existing row at the same key', () => {
    const store = new Store(schema)
    store.store([row('1', 'First')], true)
    store.addIfNotExist([row('1', 'Replacement')])

    expect(store.tables.issues.size).toBe(1)
    expect(store.tables.issues.get('["1"]')?.title).toBe('First')
  })

  test('fills in only the missing rows of a mixed batch', () => {
    const store = new Store(schema)
    store.store([row('1', 'First')], true)
    store.addIfNotExist([row('1', 'Replacement'), row('2', 'Second')])

    expect(store.tables.issues.get('["1"]')?.title).toBe('First')
    expect(store.tables.issues.get('["2"]')?.title).toBe('Second')
  })

  test('throws on an unknown table', () => {
    const store = new Store(schema)
    expect(() => store.addIfNotExist([{ type: 'INSERT', table: 'nope', data: {} } as never])).toThrow(
      'Unknown table "nope"',
    )
  })
})

const labels = table('labels')
  .columns({
    issueId: column.string(),
    name: column.string(),
    color: column.string(),
  })
  .primaryKey('issueId', 'name')

const compositeSchema = createSchema({ tables: [labels] })

type CompositeS = typeof compositeSchema

describe('Store with composite keys', () => {
  test('keys composite-key rows by their joined columns', () => {
    const store = new Store(compositeSchema)
    const insert: Mutation<CompositeS> = {
      type: 'INSERT',
      table: 'labels',
      data: { issueId: '1', name: 'bug', color: 'red' },
    }
    store.store([insert], false)

    expect(store.tables.labels.size).toBe(1)
    expect(store.tables.labels.get('["1","bug"]')).toEqual({
      issueId: '1',
      name: 'bug',
      color: 'red',
    })
  })

  test('UPDATE and DELETE target the same composite key', () => {
    const store = new Store(compositeSchema)
    store.store(
      [
        {
          type: 'INSERT',
          table: 'labels',
          data: { issueId: '1', name: 'bug', color: 'red' },
        },
        {
          type: 'UPDATE',
          table: 'labels',
          id: { issueId: '1', name: 'bug' },
          changes: { color: 'green' },
        },
      ],
      false,
    )

    expect(store.tables.labels.get('["1","bug"]')?.color).toBe('green')

    store.store(
      [
        {
          type: 'DELETE',
          table: 'labels',
          id: { issueId: '1', name: 'bug' },
        },
      ],
      false,
    )

    expect(store.tables.labels.has('["1","bug"]')).toBe(false)
  })
})
