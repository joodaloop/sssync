import { describe, expect, spyOn, test } from 'bun:test'

import type { Mutation } from '../src/mutators'
import { column, createSchema, table } from '../src/schema'
import { Store, type StoreRowChange } from '../src/store'

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
type IssueChanges = Partial<{
  title: string
  priority: number
  done: boolean
}>

const issue = (id: string, title: string): Mutation<S> => ({
  type: 'INSERT',
  table: 'issues',
  data: issueData(id, title),
})

const issueData = (id: string, title: string) => ({ id, title, priority: 1, done: false })

const updateIssue = (id: string, changes: IssueChanges): Mutation<S> => ({
  type: 'UPDATE',
  table: 'issues',
  id: { id },
  changes,
})

const removeIssue = (id: string): Mutation<S> => ({
  type: 'DELETE',
  table: 'issues',
  id: { id },
})

function collectRowChanges(store: Store<S>) {
  const received: StoreRowChange[][] = []
  const unsubscribe = store.subscribeToRowChanges(changes => received.push([...changes]))
  return { received, unsubscribe }
}

describe('Store.applyMutation', () => {
  test('creates one Map per table', () => {
    const store = new Store(schema)

    expect(store.tables.issues).toBeInstanceOf(Map)
    expect(store.tables.issues.size).toBe(0)
  })

  test('stores INSERT rows keyed by primary key', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First'), issue('2', 'Second')])

    expect(store.tables.issues.size).toBe(2)
    expect(store.tables.issues.get('["1"]')).toEqual(issueData('1', 'First'))
  })

  test('merges UPDATE changes into an existing row', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First'), updateIssue('1', { done: true })])

    expect(store.tables.issues.get('["1"]')).toEqual({
      ...issueData('1', 'First'),
      done: true,
    })
  })

  test('panics on UPDATE for a missing row', () => {
    const store = new Store(schema)

    expect(() => store.applyMutation([updateIssue('99', { done: true })])).toThrow(
      'UPDATE cannot apply: no live "issues" row',
    )

    expect(store.tables.issues.has('["99"]')).toBe(false)
  })

  test('removes rows on DELETE', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First'), removeIssue('1')])

    // The row is gone from reads, but the key is kept as a tombstone.
    expect(store.tables.issues.get('["1"]')).toBeUndefined()
    expect(store.tables.issues.has('["1"]')).toBe(true)
  })

  test('reads a row by table and id', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First')])

    expect(store.getRowFromTable('issues', '1')).toEqual(issueData('1', 'First'))
  })
})

describe('Store.subscribeToRowChanges', () => {
  test('publishes one insert for an inserted row', () => {
    const store = new Store(schema)
    const { received } = collectRowChanges(store)

    store.applyMutation([issue('1', 'First')])

    expect(received).toEqual([
      [
        {
          type: 'insert',
          table: 'issues',
          key: '["1"]',
          row: issueData('1', 'First'),
        },
      ],
    ])
  })

  test('publishes only changed fields for an existing row update', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First')])
    const { received } = collectRowChanges(store)

    store.applyMutation([updateIssue('1', { done: true, priority: 1 })])

    expect(received).toEqual([
      [
        {
          type: 'update',
          table: 'issues',
          key: '["1"]',
          changes: { done: true },
        },
      ],
    ])
  })

  test('publishes one remove for a deleted existing row', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First')])
    const { received } = collectRowChanges(store)

    store.applyMutation([removeIssue('1')])

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

  test('collapses multiple writes to one final insert patch', () => {
    const store = new Store(schema)
    const { received } = collectRowChanges(store)

    store.applyMutation([issue('1', 'First'), updateIssue('1', { done: true, title: 'Renamed' })])

    expect(received).toEqual([
      [
        {
          type: 'insert',
          table: 'issues',
          key: '["1"]',
          row: { ...issueData('1', 'Renamed'), done: true },
        },
      ],
    ])
  })

  test('collapses insert-then-delete batches to no notification', () => {
    const store = new Store(schema)
    const { received } = collectRowChanges(store)

    store.applyMutation([issue('1', 'First'), updateIssue('1', { done: true }), removeIssue('1')])

    expect(received).toEqual([])
  })

  test('collapses update-then-delete batches to one remove patch', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First')])
    const { received } = collectRowChanges(store)

    store.applyMutation([updateIssue('1', { done: true }), removeIssue('1')])

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

  test('does not publish no-op updates or missing-row deletes', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First')])
    const { received } = collectRowChanges(store)

    store.applyMutation([updateIssue('1', { done: false }), removeIssue('99')])

    expect(received).toEqual([])
  })

  test('stops publishing after unsubscribe', () => {
    const store = new Store(schema)
    const { received, unsubscribe } = collectRowChanges(store)
    unsubscribe()

    store.applyMutation([issue('1', 'First')])

    expect(received).toEqual([])
  })
})

describe('Store.addIfNotExist', () => {
  test('adds rows that are currently absent', () => {
    const store = new Store(schema)
    store.addIfNotExist({ issues: [issueData('1', 'First'), issueData('2', 'Second')] })

    expect(store.tables.issues.size).toBe(2)
    expect(store.tables.issues.get('["1"]')).toEqual(issueData('1', 'First'))
  })

  test('does not clobber an existing row at the same key', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First')])
    store.addIfNotExist({ issues: [issueData('1', 'Replacement')] })

    expect(store.tables.issues.size).toBe(1)
    expect(store.tables.issues.get('["1"]')?.title).toBe('First')
  })

  test('fills in only the missing rows of a mixed batch', () => {
    const store = new Store(schema)
    store.applyMutation([issue('1', 'First')])
    store.addIfNotExist({ issues: [issueData('1', 'Replacement'), issueData('2', 'Second')] })

    expect(store.tables.issues.get('["1"]')?.title).toBe('First')
    expect(store.tables.issues.get('["2"]')?.title).toBe('Second')
  })

  test('publishes insert patches for newly added rows', () => {
    const store = new Store(schema)
    const { received } = collectRowChanges(store)

    store.addIfNotExist({ issues: [issueData('1', 'First'), issueData('2', 'Second')] })

    expect(received).toEqual([
      [
        {
          type: 'insert',
          table: 'issues',
          key: '["1"]',
          row: issueData('1', 'First'),
        },
        {
          type: 'insert',
          table: 'issues',
          key: '["2"]',
          row: issueData('2', 'Second'),
        },
      ],
    ])
  })

  test('throws on an unknown table', () => {
    const store = new Store(schema)
    const invalidRowsByTable = { nope: [{}] } as unknown as Parameters<typeof store.addIfNotExist>[0]

    expect(() => store.addIfNotExist(invalidRowsByTable)).toThrow('Unknown table "nope"')
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
    store.applyMutation([
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
    ])

    expect(store.tables.labels.get('["1","bug"]')?.color).toBe('green')

    store.applyMutation([
      {
        type: 'DELETE',
        table: 'labels',
        id: { issueId: '1', name: 'bug' },
      },
    ])

    // The row is gone from reads, but the key is kept as a tombstone.
    expect(store.tables.labels.get('["1","bug"]')).toBeUndefined()
    expect(store.tables.labels.has('["1","bug"]')).toBe(true)
  })
})
