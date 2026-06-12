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

const labelsTable = table('labels')
  .columns({
    id: column.string(),
    name: column.string(),
  })
  .primaryKey('id')

const issueLabelsTable = table('issueLabels')
  .columns({
    id: column.string(),
    issueId: column.string(),
    labelId: column.string(),
  })
  .primaryKey('id')

const issueLabelRelationships = relationships(issuesTable, ({ many }) => ({
  labels: many(
    {
      sourceField: ['id'],
      destField: ['issueId'],
      destSchema: issueLabelsTable,
    },
    {
      sourceField: ['labelId'],
      destField: ['id'],
      destSchema: labelsTable,
    },
  ),
}))

const manyToManySchema = createSchema({
  tables: [issuesTable, labelsTable, issueLabelsTable],
  relationships: [issueLabelRelationships],
})

const issueStatusRelationships = relationships(issuesTable, ({ many }) => ({
  commentsByStatus: many({
    sourceField: ['status'],
    destField: ['status'],
    destSchema: commentsTable,
  }),
}))

const statusRelationshipSchema = createSchema({
  tables: [issuesTable, commentsTable],
  relationships: [issueStatusRelationships],
})

describe('query runtime', () => {
  test('materializes where queries from row tables', () => {
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
    expect(changes.map(change => [change.type, change.table, change.id])).toEqual([
      ['add', 'issues', 'i1'],
      ['update', 'issues', 'i1'],
      ['delete', 'issues', 'i1'],
    ])
    expect(subscription.rows()).toEqual([])

    subscription.unsubscribe()
  })

  test('where delete deltas keep the old row payload after updates', () => {
    const runtime = createQueryRuntime(schema)
    const spec = query(schema).issues.where(q => q.eq('status', 'open')).toSpec()
    const changes: RowChange[] = []

    runtime.add('issues', {
      id: 'i1',
      title: 'First',
      status: 'open',
      priority: 1,
    })

    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('issues', 'i1', { status: 'closed' })

    expect(runtime.table('issues').get('i1')).toEqual({
      id: 'i1',
      title: 'First',
      status: 'closed',
      priority: 1,
    })
    expect(changes).toEqual([
      {
        type: 'delete',
        table: 'issues',
        id: 'i1',
        old: {
          id: 'i1',
          title: 'First',
          status: 'open',
          priority: 1,
        },
      },
    ])

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

  test('single exposes an id-only source node snapshot', () => {
    const runtime = createQueryRuntime(schema)
    runtime.add('issues', {
      id: 'i1',
      title: 'Target',
      status: 'open',
      priority: 1,
    })

    const spec = query(schema).issues.single('i1').toSpec()
    const pipeline = runtime.compile(spec)

    expect(pipeline.nodes()).toMatchObject([
      {
        type: 'single',
        table: 'issues',
        rowCount: 1,
        rowIds: ['i1'],
      },
    ])

    pipeline.dispose()
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

  test('related indexes source rows that appear after subscription', () => {
    const runtime = createQueryRuntime(schema)
    runtime.add('comments', {
      id: 'c1',
      issueId: 'i1',
      body: 'preloaded comment',
      status: 'visible',
    })

    const spec = query(schema).issues.single('i1').related('comments').toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.add('issues', {
      id: 'i1',
      title: 'Late source',
      status: 'open',
      priority: 1,
    })

    expect(changes.map(change => change.type)).toEqual(['add'])
    expect(subscription.rows()).toEqual([
      { id: 'c1', issueId: 'i1', body: 'preloaded comment', status: 'visible' },
    ])
    subscription.unsubscribe()
  })

  test('related emits child updates from the related table side channel', () => {
    const runtime = createQueryRuntime(schema)
    runtime.add('issues', {
      id: 'i1',
      title: 'Target',
      status: 'open',
      priority: 1,
    })
    runtime.add('comments', {
      id: 'c1',
      issueId: 'i1',
      body: 'before',
      status: 'visible',
    })

    const spec = query(schema).issues.single('i1').related('comments').toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('comments', 'c1', { body: 'after' })

    expect(changes.map(change => change.type)).toEqual(['update'])
    expect(subscription.rows()).toEqual([
      { id: 'c1', issueId: 'i1', body: 'after', status: 'visible' },
    ])
    subscription.unsubscribe()
  })

  test('related moves children when the relationship key changes', () => {
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
      body: 'before',
      status: 'visible',
    })

    const spec = query(schema).issues.single('i1').related('comments').toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('comments', 'c1', { issueId: 'i2' })

    expect(changes.map(change => change.type)).toEqual(['delete'])
    expect(subscription.rows()).toEqual([])
    subscription.unsubscribe()
  })

  test('related emits update when a child moves between active parents', () => {
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
      status: 'open',
      priority: 1,
    })
    runtime.add('comments', {
      id: 'c1',
      issueId: 'i1',
      body: 'comment',
      status: 'visible',
    })

    const spec = query(schema).issues
      .where(q => q.eq('status', 'open'))
      .related('comments')
      .toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('comments', 'c1', { issueId: 'i2' })

    expect(changes.map(change => change.type)).toEqual(['update'])
    expect(subscription.rows()).toEqual([
      { id: 'c1', issueId: 'i2', body: 'comment', status: 'visible' },
    ])
    subscription.unsubscribe()
  })

  test('related does not emit when parent changes without changing relationship key', () => {
    const runtime = createQueryRuntime(schema)
    runtime.add('issues', {
      id: 'i1',
      title: 'Target',
      status: 'open',
      priority: 1,
    })
    runtime.add('comments', {
      id: 'c1',
      issueId: 'i1',
      body: 'comment',
      status: 'visible',
    })

    const spec = query(schema).issues.single('i1').related('comments').toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('issues', 'i1', { title: 'Renamed' })

    expect(changes).toEqual([])
    expect(subscription.rows()).toEqual([
      { id: 'c1', issueId: 'i1', body: 'comment', status: 'visible' },
    ])
    subscription.unsubscribe()
  })

  test('many-to-many related emits final edge diffs', () => {
    const runtime = createQueryRuntime(manyToManySchema)
    runtime.add('issues', {
      id: 'i1',
      title: 'Target',
      status: 'open',
      priority: 1,
    })
    runtime.add('labels', {
      id: 'l1',
      name: 'Bug',
    })
    runtime.add('labels', {
      id: 'l2',
      name: 'Feature',
    })
    runtime.add('issueLabels', {
      id: 'il1',
      issueId: 'i1',
      labelId: 'l1',
    })

    const spec = query(manyToManySchema).issues.single('i1').related('labels').toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('issueLabels', 'il1', { labelId: 'l2' })

    expect(changes.map(change => change.type)).toEqual(['delete', 'add'])
    expect(subscription.rows()).toEqual([{ id: 'l2', name: 'Feature' }])
    subscription.unsubscribe()
  })

  test('many-to-many related emits final row updates', () => {
    const runtime = createQueryRuntime(manyToManySchema)
    runtime.add('issues', {
      id: 'i1',
      title: 'Target',
      status: 'open',
      priority: 1,
    })
    runtime.add('labels', {
      id: 'l1',
      name: 'Bug',
    })
    runtime.add('issueLabels', {
      id: 'il1',
      issueId: 'i1',
      labelId: 'l1',
    })

    const spec = query(manyToManySchema).issues.single('i1').related('labels').toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('labels', 'l1', { name: 'Defect' })

    expect(changes.map(change => change.type)).toEqual(['update'])
    expect(subscription.rows()).toEqual([{ id: 'l1', name: 'Defect' }])
    subscription.unsubscribe()
  })

  test('many-to-many junction changes do not update retained final rows', () => {
    const runtime = createQueryRuntime(manyToManySchema)
    runtime.add('issues', {
      id: 'i1',
      title: 'Target',
      status: 'open',
      priority: 1,
    })
    runtime.add('labels', {
      id: 'l1',
      name: 'Bug',
    })
    runtime.add('labels', {
      id: 'l2',
      name: 'Feature',
    })
    runtime.add('labels', {
      id: 'l3',
      name: 'Chore',
    })
    runtime.add('issueLabels', {
      id: 'il1',
      issueId: 'i1',
      labelId: 'l1',
    })
    runtime.add('issueLabels', {
      id: 'il2',
      issueId: 'i1',
      labelId: 'l2',
    })

    const spec = query(manyToManySchema).issues.single('i1').related('labels').toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('issueLabels', 'il1', { labelId: 'l3' })

    expect(changes.map(change => [change.type, change.id])).toEqual([
      ['delete', 'l1'],
      ['add', 'l3'],
    ])
    subscription.unsubscribe()
  })

  test('shared relationship index keeps duplicate source keys tracked', () => {
    const runtime = createQueryRuntime(statusRelationshipSchema)
    runtime.add('issues', {
      id: 'i1',
      title: 'First',
      status: 'open',
      priority: 1,
    })
    runtime.add('issues', {
      id: 'i2',
      title: 'Second',
      status: 'open',
      priority: 1,
    })
    runtime.add('comments', {
      id: 'c1',
      issueId: 'unused',
      body: 'before',
      status: 'open',
    })

    const spec = query(statusRelationshipSchema).issues
      .where(q => q.eq('status', 'open'))
      .related('commentsByStatus')
      .toSpec()
    const changes: RowChange[] = []
    const subscription = runtime.subscribe(spec, change => {
      changes.push(change)
    })

    runtime.update('issues', 'i1', { status: 'closed' })
    runtime.update('comments', 'c1', { body: 'after' })

    expect(changes.map(change => change.type)).toEqual(['update'])
    expect(subscription.rows()).toEqual([
      { id: 'c1', issueId: 'unused', body: 'after', status: 'open' },
    ])
    subscription.unsubscribe()
  })
})
