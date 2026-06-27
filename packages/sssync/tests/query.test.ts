import { describe, expect, test } from 'bun:test'
import { column, createSchema, relationships, table } from '../src/schema'
import { store } from '../src/query'

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    ownerId: column.string().optional(),
  })
  .primaryKey('id')

const comments = table('comments')
  .columns({
    id: column.string(),
    issueId: column.string(),
    body: column.string(),
  })
  .primaryKey('id')

const users = table('users')
  .columns({
    id: column.string(),
    name: column.string(),
  })
  .primaryKey('id')

const memberships = table('memberships')
  .columns({
    issueId: column.string(),
    userId: column.string(),
  })
  .primaryKey('issueId', 'userId')

const issueRelationships = relationships(issues, ({ many, one }) => ({
  comments: many({
    sourceField: ['id'],
    destField: ['issueId'],
    destSchema: comments,
  }),
  owner: one({
    sourceField: ['ownerId'],
    destField: ['id'],
    destSchema: users,
  }),
  assignedUsers: many(
    {
      sourceField: ['id'],
      destField: ['issueId'],
      destSchema: memberships,
    },
    {
      sourceField: ['userId'],
      destField: ['id'],
      destSchema: users,
    },
  ),
}))

const schema = createSchema({
  tables: [issues, comments, users, memberships],
  relationships: [issueRelationships],
})

describe('query store', () => {
  test('builds all-query descriptors', () => {
    const db = store(schema)

    expect(db.all('issues')).toEqual({
      key: 'issues',
      accessKeys: ['issues'],
      plan: {
        kind: 'all',
        table: 'issues',
      },
    })
  })

  test('builds one-query descriptors', () => {
    const db = store(schema)

    expect(db.one('issues', { id: 'issue-1' })).toEqual({
      key: 'issues:issue-1',
      accessKeys: ['issues:issue-1'],
      plan: {
        kind: 'one',
        table: 'issues',
        id: 'issue-1',
        include: [],
      },
    })
  })

  test('builds include-query descriptors with compact access keys', () => {
    const db = store(schema)

    expect(
      db.one('issues', {
        id: 'issue-1',
        include: ['comments', 'owner'],
      }),
    ).toEqual({
      key: 'issues:issue-1?include=comments,owner',
      accessKeys: [
        'issues:issue-1',
        'issues:issue-1:comments',
        'issues:issue-1:owner',
      ],
      plan: {
        kind: 'one',
        table: 'issues',
        id: 'issue-1',
        include: ['comments', 'owner'],
      },
    })
  })

  test('does not store relationship metadata on include queries', () => {
    const db = store(schema)
    const query = db.one('issues', {
      id: 'issue-1',
      include: ['assignedUsers'],
    })

    expect(query).toEqual({
      key: 'issues:issue-1?include=assignedUsers',
      accessKeys: ['issues:issue-1', 'issues:issue-1:assignedUsers'],
      plan: {
        kind: 'one',
        table: 'issues',
        id: 'issue-1',
        include: ['assignedUsers'],
      },
    })
    expect('relationship' in query.plan).toBe(false)
  })

  test('serializes composite ids in canonical key order', () => {
    const db = store(schema)

    expect(
      db.one('memberships', {
        id: { issueId: 'issue-1', userId: 'user-1' },
      }).key,
    ).toBe('memberships:issueId=issue-1,userId=user-1')
  })
})
