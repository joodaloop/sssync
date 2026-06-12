import { describe, expect, test } from 'bun:test'
import { column, createSchema, relationships, table } from '@sssync/zero-schema'
import { createQueryRuntime, query, type RowChange } from '../index'

const issuesTable = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    status: column.string(),
    priority: column.number(),
  })
  .primaryKey('id')

const commentsTable = table('comments')
  .columns({
    id: column.string(),
    issueId: column.string(),
    body: column.string(),
    status: column.string(),
  })
  .primaryKey('id')

const issueRelationships = relationships(issuesTable, ({ many }) => ({
  comments: many({
    sourceField: ['id'],
    destField: ['issueId'],
    destSchema: commentsTable,
  }),
}))

const schema = createSchema({
  tables: [issuesTable, commentsTable],
  relationships: [issueRelationships],
})

describe('query runtime', () => {
  test('materializes where queries from row maps', () => {
    const runtime = createQueryRuntime(schema)

    runtime.add('issues', {
      id: 'i1',
      title: 'First',
      status: 'open',
      priority: 1,
    })
    runtime.add('issues', {
      id: 'i2',
      title: 'Second',
      status: 'closed',
      priority: 2,
    })

    const spec = query(schema).issues.where(q => q.eq('status', 'open')).toSpec()

    expect(runtime.materialize(spec)).toEqual([
      { id: 'i1', title: 'First', status: 'open', priority: 1 },
    ])
  })

  test('emits query diffs when external code sends row changes', () => {
    const runtime = createQueryRuntime(schema)
    const spec = query(schema).issues.where(q => q.eq('status', 'open')).toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.add('issues', {
      id: 'i1',
      title: 'First',
      status: 'closed',
      priority: 1,
    })
    runtime.update('issues', 'i1', { status: 'open' })
    runtime.update('issues', 'i1', { title: 'Renamed' })
    runtime.delete('issues', 'i1')

    expect(changes.map(change => change.type)).toEqual(['add', 'update', 'delete'])
    expect(subscription.rows()).toEqual([])

    subscription.unsubscribe()
  })

  test('materializes chained related and where stages', () => {
    const runtime = createQueryRuntime(schema)

    runtime.add('issues', {
      id: 'i1',
      title: 'Open',
      status: 'open',
      priority: 1,
    })
    runtime.add('issues', {
      id: 'i2',
      title: 'Closed',
      status: 'closed',
      priority: 1,
    })
    runtime.add('comments', {
      id: 'c1',
      issueId: 'i1',
      body: 'shown',
      status: 'visible',
    })
    runtime.add('comments', {
      id: 'c2',
      issueId: 'i1',
      body: 'hidden',
      status: 'hidden',
    })
    runtime.add('comments', {
      id: 'c3',
      issueId: 'i2',
      body: 'wrong issue',
      status: 'visible',
    })

    const spec = query(schema).issues
      .where(q => q.eq('status', 'open'))
      .related('comments')
      .where(q => q.eq('status', 'visible'))
      .toSpec()

    expect(runtime.materialize(spec)).toEqual([
      { id: 'c1', issueId: 'i1', body: 'shown', status: 'visible' },
    ])
  })

  test('related subscriptions respond to parent and child changes', () => {
    const runtime = createQueryRuntime(schema)
    const spec = query(schema).issues
      .where(q => q.eq('status', 'open'))
      .related('comments')
      .where(q => q.eq('status', 'visible'))
      .toSpec()
    const changes: RowChange[] = []

    runtime.add('issues', {
      id: 'i1',
      title: 'Closed',
      status: 'closed',
      priority: 1,
    })
    runtime.add('comments', {
      id: 'c1',
      issueId: 'i1',
      body: 'hello',
      status: 'visible',
    })

    runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('issues', 'i1', { status: 'open' })
    runtime.update('comments', 'c1', { status: 'hidden' })

    expect(changes.map(change => change.type)).toEqual(['add', 'delete'])
  })

  test('exposes pipeline node snapshots', () => {
    const runtime = createQueryRuntime(schema)
    runtime.add('issues', {
      id: 'i1',
      title: 'Open',
      status: 'open',
      priority: 1,
    })
    runtime.add('comments', {
      id: 'c1',
      issueId: 'i1',
      body: 'hello',
      status: 'visible',
    })

    const spec = query(schema).issues
      .where(q => q.eq('status', 'open'))
      .related('comments')
      .where(q => q.eq('status', 'visible'))
      .toSpec()
    const pipeline = runtime.compile(spec)

    expect(pipeline.nodes().map(node => node.type)).toEqual([
      'table',
      'where',
      'related',
      'where',
    ])
    expect(pipeline.nodes().map(node => node.rowIds)).toEqual([
      ['i1'],
      ['i1'],
      ['c1'],
      ['c1'],
    ])

    pipeline.dispose()
  })

  test('single tracks one row reactively', () => {
    const runtime = createQueryRuntime(schema)
    const spec = query(schema).issues.single('i1').toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.add('issues', {
      id: 'i2',
      title: 'Other',
      status: 'open',
      priority: 1,
    })
    runtime.add('issues', {
      id: 'i1',
      title: 'Target',
      status: 'open',
      priority: 1,
    })
    runtime.update('issues', 'i1', { title: 'Target renamed' })
    runtime.delete('issues', 'i1')

    expect(changes.map(change => change.type)).toEqual(['add', 'update', 'delete'])
    expect(subscription.rows()).toEqual([])
    subscription.unsubscribe()
  })

  test('single can traverse related rows', () => {
    const runtime = createQueryRuntime(schema)
    runtime.add('issues', {
      id: 'i1',
      title: 'Target',
      status: 'open',
      priority: 1,
    })
    runtime.add('issues', {
      id: 'i2',
      title: 'Other',
      status: 'open',
      priority: 1,
    })
    runtime.add('comments', {
      id: 'c1',
      issueId: 'i1',
      body: 'target comment',
      status: 'visible',
    })
    runtime.add('comments', {
      id: 'c2',
      issueId: 'i2',
      body: 'other comment',
      status: 'visible',
    })

    const spec = query(schema).issues.single('i1').related('comments').toSpec()

    expect(runtime.materialize(spec)).toEqual([
      { id: 'c1', issueId: 'i1', body: 'target comment', status: 'visible' },
    ])
  })
})
