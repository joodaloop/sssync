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

const commentRelationships = relationships(comments, ({ one }) => ({
  issue: one({
    sourceField: ['issueId'],
    destField: ['id'],
    destSchema: issues,
  }),
}))

const schema = createSchema({
  tables: [issues, comments, users, memberships],
  relationships: [issueRelationships, commentRelationships],
})

describe('query store', () => {
  test('builds query descriptors with canonical keys', () => {
    const db = store(schema)

    expect(db.issues.all().key).toBe('issues')
    expect(db.issues.one('issue-1').key).toBe('issues:issue-1')
    expect(db.issues.one('issue-1').comments.key).toBe(
      'issues:issue-1:comments',
    )
  })

  test('records all and one query plans', () => {
    const db = store(schema)

    expect(db.issues.all().plan).toEqual({
      kind: 'all',
      table: 'issues',
    })
    expect(db.issues.one('issue-1').plan).toEqual({
      kind: 'one',
      table: 'issues',
      id: 'issue-1',
    })
  })

  test('records one-hop relation plans', () => {
    const db = store(schema)
    const commentsQuery = db.issues.one('issue-1').comments

    expect(commentsQuery.plan).toEqual({
      kind: 'relation',
      parent: {
        kind: 'one',
        table: 'issues',
        id: 'issue-1',
      },
      sourceTable: 'issues',
      relation: 'comments',
      destTable: 'comments',
      cardinality: 'many',
      relationship: schema.relationships.issues.comments,
    })
  })

  test('records junction relation plans without dropping either hop', () => {
    const db = store(schema)
    const assignedUsersQuery = db.issues.one('issue-1').assignedUsers

    expect(assignedUsersQuery.key).toBe('issues:issue-1:assignedUsers')
    expect(assignedUsersQuery.plan).toEqual({
      kind: 'relation',
      parent: {
        kind: 'one',
        table: 'issues',
        id: 'issue-1',
      },
      sourceTable: 'issues',
      relation: 'assignedUsers',
      destTable: 'users',
      cardinality: 'many',
      relationship: schema.relationships.issues.assignedUsers,
    })
    expect(assignedUsersQuery.plan.relationship).toHaveLength(2)
  })

  test('allows nested relation descriptors through one relations', () => {
    const db = store(schema)
    const nested = db.comments.one('comment-1').issue.comments

    expect(nested.key).toBe('comments:comment-1:issue:comments')
    expect(nested.plan.kind).toBe('relation')
    expect(nested.plan.parent).toEqual({
      kind: 'relation',
      parent: {
        kind: 'one',
        table: 'comments',
        id: 'comment-1',
      },
      sourceTable: 'comments',
      relation: 'issue',
      destTable: 'issues',
      cardinality: 'one',
      relationship: schema.relationships.comments.issue,
    })
  })
})
