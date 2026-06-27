import { column, createSchema, relationships, table } from '../src/schema'
import { store, type Query, type QueryValue } from '../src/query'

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
    role: column.enumeration<'admin' | 'member'>(),
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

const db = store(schema)

const allIssues = db.query('issues')
const allIssuesQuery: Query<
  readonly {
    id: string
    title: string
    ownerId: string | null
  }[]
> = allIssues
allIssuesQuery

type AllIssueRows = QueryValue<typeof allIssues>
const allIssueRows: AllIssueRows = [
  {
    id: 'issue-1',
    title: 'Hello',
    ownerId: null,
  },
]
allIssueRows

const issue = db.query('issues', { id: 'issue-1' })
type IssueRow = QueryValue<typeof issue>
const maybeIssue: IssueRow = undefined
maybeIssue

const issueWithComments = db.query('issues', {
  id: 'issue-1',
  include: ['comments'],
})
type IssueWithComments = QueryValue<typeof issueWithComments>
const maybeIssueWithComments: IssueWithComments = {
  id: 'issue-1',
  title: 'Hello',
  ownerId: null,
  comments: [
    {
      id: 'comment-1',
      issueId: 'issue-1',
      body: 'Nice',
    },
  ],
}
maybeIssueWithComments

const issueWithOwner = db.query('issues', {
  id: 'issue-1',
  include: ['owner'],
})
type IssueWithOwner = QueryValue<typeof issueWithOwner>
const maybeIssueWithOwner: IssueWithOwner = {
  id: 'issue-1',
  title: 'Hello',
  ownerId: 'user-1',
  owner: { id: 'user-1', name: 'Ada' },
}
maybeIssueWithOwner

const issueWithAssignedUsers = db.query('issues', {
  id: 'issue-1',
  include: ['assignedUsers'],
})
type IssueWithAssignedUsers = QueryValue<typeof issueWithAssignedUsers>
const maybeIssueWithAssignedUsers: IssueWithAssignedUsers = {
  id: 'issue-1',
  title: 'Hello',
  ownerId: null,
  assignedUsers: [{ id: 'user-1', name: 'Ada' }],
}
maybeIssueWithAssignedUsers

db.query('memberships', { id: { issueId: 'issue-1', userId: 'user-1' } })

// @ts-expect-error table names come from the schema
db.query('missing')

// @ts-expect-error one-query id type comes from the primary key
db.query('issues', { id: 123 })

// @ts-expect-error composite primary keys require every key column
db.query('memberships', { id: { issueId: 'issue-1' } })

// @ts-expect-error include names come from schema.relationships.issues
db.query('issues', { id: 'issue-1', include: ['missingRelation'] })

// @ts-expect-error include requires a row id
db.query('issues', { include: ['comments'] })

db.query('memberships', {
  id: { issueId: 'issue-1', userId: 'user-1' },
  // @ts-expect-error memberships has no relationships in this schema
  include: ['issues'],
})
