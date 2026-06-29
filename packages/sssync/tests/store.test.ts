import { describe, expect, test } from 'bun:test'

import type { Mutation } from '../src/mutators'
import { column, createSchema, table } from '../src/schema'
import { Store } from '../src/store'

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

const row = (id: string, title: string): Mutation<S> => ({
  type: 'INSERT',
  table: 'issues',
  data: { id, title, priority: 1, done: false },
})

const rowData = (id: string, title: string) => ({ id, title, priority: 1, done: false })

describe('Store', () => {
  test('creates one Map per table', () => {
    const store = new Store(schema)
    expect(store.tables.issues).toBeInstanceOf(Map)
    expect(store.tables.issues.size).toBe(0)
  })

  test('stores INSERT rows keyed by primary key', () => {
    const store = new Store(schema)
    store.applyMutation([row('1', 'First'), row('2', 'Second')])

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
    store.applyMutation(
      [row('1', 'First'), { type: 'UPDATE', table: 'issues', id: { id: '1' }, changes: { done: true } }],
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
    store.applyMutation([{ type: 'UPDATE', table: 'issues', id: { id: '99' }, changes: { done: true } }])

    expect(store.tables.issues.has('["99"]')).toBe(false)
  })

  test('DELETE removes the row', () => {
    const store = new Store(schema)
    store.applyMutation([row('1', 'First'), { type: 'DELETE', table: 'issues', id: { id: '1' } }])

    expect(store.tables.issues.has('["1"]')).toBe(false)
  })

  test('reads a row from a table by id', () => {
    const store = new Store(schema)
    store.applyMutation([row('1', 'First')])

    expect(store.getRowFromTable('issues', '1')).toEqual({
      id: '1',
      title: 'First',
      priority: 1,
      done: false,
    })
  })

  test('publishes collapsed row changes from mutation batches', () => {
    const store = new Store(schema)
    const received: unknown[] = []
    store.subscribeToRowChanges(changes => received.push(changes))

    store.applyMutation(
      [
        row('1', 'First'),
        {
          type: 'UPDATE',
          table: 'issues',
          id: { id: '1' },
          changes: { done: true },
        },
      ],
    )

    expect(received).toEqual([
      [
        {
          type: 'insert',
          table: 'issues',
          key: '["1"]',
          row: { id: '1', title: 'First', priority: 1, done: true },
        },
      ],
    ])
  })

  test('does not publish when a mutation batch has no final visible change', () => {
    const store = new Store(schema)
    const received: unknown[] = []
    store.subscribeToRowChanges(changes => received.push(changes))

    store.applyMutation(
      [
        row('1', 'First'),
        {
          type: 'UPDATE',
          table: 'issues',
          id: { id: '1' },
          changes: { done: true },
        },
        {
          type: 'DELETE',
          table: 'issues',
          id: { id: '1' },
        },
      ],
    )

    expect(received).toEqual([])
  })

  test('publishes only changed fields for an existing row update', () => {
    const store = new Store(schema)
    store.applyMutation([row('1', 'First')])
    const received: unknown[] = []
    store.subscribeToRowChanges(changes => received.push(changes))

    store.applyMutation(
      [
        {
          type: 'UPDATE',
          table: 'issues',
          id: { id: '1' },
          changes: { done: true, title: 'Renamed' },
        },
      ],
    )

    expect(received).toEqual([
      [
        {
          type: 'update',
          table: 'issues',
          key: '["1"]',
          changes: { title: 'Renamed', done: true },
        },
      ],
    ])
  })

  test('publishes a single remove when an existing row is updated then deleted', () => {
    const store = new Store(schema)
    store.applyMutation([row('1', 'First')])
    const received: unknown[] = []
    store.subscribeToRowChanges(changes => received.push(changes))

    store.applyMutation(
      [
        {
          type: 'UPDATE',
          table: 'issues',
          id: { id: '1' },
          changes: { done: true },
        },
        {
          type: 'DELETE',
          table: 'issues',
          id: { id: '1' },
        },
      ],
    )

    expect(received).toEqual([
      [
        {
          type: 'remove',
          table: 'issues',
          key: '["1"]',
        },
      ],
    ])
  })

  test('does not publish no-op updates', () => {
    const store = new Store(schema)
    store.applyMutation([row('1', 'First')])
    const received: unknown[] = []
    store.subscribeToRowChanges(changes => received.push(changes))

    store.applyMutation([{ type: 'UPDATE', table: 'issues', id: { id: '1' }, changes: { done: false } }])

    expect(received).toEqual([])
  })
})

describe('Store.addIfNotExist', () => {
  test('adds rows that are currently absent', () => {
    const store = new Store(schema)
    store.addIfNotExist({ issues: [rowData('1', 'First'), rowData('2', 'Second')] })

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
    store.applyMutation([row('1', 'First')])
    store.addIfNotExist({ issues: [rowData('1', 'Replacement')] })

    expect(store.tables.issues.size).toBe(1)
    expect(store.tables.issues.get('["1"]')?.title).toBe('First')
  })

  test('fills in only the missing rows of a mixed batch', () => {
    const store = new Store(schema)
    store.applyMutation([row('1', 'First')])
    store.addIfNotExist({ issues: [rowData('1', 'Replacement'), rowData('2', 'Second')] })

    expect(store.tables.issues.get('["1"]')?.title).toBe('First')
    expect(store.tables.issues.get('["2"]')?.title).toBe('Second')
  })

  test('publishes row changes for newly added rows', () => {
    const store = new Store(schema)
    const received: unknown[] = []
    store.subscribeToRowChanges(changes => received.push(changes))

    store.addIfNotExist({ issues: [rowData('1', 'First'), rowData('2', 'Second')] })

    expect(received).toEqual([
      [
        {
          type: 'insert',
          table: 'issues',
          key: '["1"]',
          row: { id: '1', title: 'First', priority: 1, done: false },
        },
        {
          type: 'insert',
          table: 'issues',
          key: '["2"]',
          row: { id: '2', title: 'Second', priority: 1, done: false },
        },
      ],
    ])
  })

  test('throws on an unknown table', () => {
    const store = new Store(schema)
    expect(() => store.addIfNotExist({ nope: [{}] })).toThrow('Unknown table "nope"')
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
    store.applyMutation([insert])

    expect(store.tables.labels.size).toBe(1)
    expect(store.tables.labels.get('["1","bug"]')).toEqual({
      issueId: '1',
      name: 'bug',
      color: 'red',
    })
  })

  test('UPDATE and DELETE target the same composite key', () => {
    const store = new Store(compositeSchema)
    store.applyMutation(
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
    )

    expect(store.tables.labels.get('["1","bug"]')?.color).toBe('green')

    store.applyMutation(
      [
        {
          type: 'DELETE',
          table: 'labels',
          id: { issueId: '1', name: 'bug' },
        },
      ],
    )

    expect(store.tables.labels.has('["1","bug"]')).toBe(false)
  })
})
