import { store } from '../src/query'
import type { Query, QueryDetails, QueryValue } from '../src/query'
import { column, createSchema, relationships, table } from '../src/schema'

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

const allIssues = db.all('issues')
const allIssuesQuery: Query<
  readonly {
    id: string
    title: string
    ownerId: string | null
  }[]
> = allIssues
allIssuesQuery

const readyDetails: QueryDetails = { status: 'ready' }
readyDetails

const errorDetails: QueryDetails = {
  status: 'error',
  error: new Error('Query failed'),
}
errorDetails

const badDetails: QueryDetails = {
  // @ts-expect-error query details only describe resolved or errored resources
  status: 'pending',
}
badDetails

type AllIssueRows = QueryValue<typeof allIssues>
const allIssueRows: AllIssueRows = [
  {
    id: 'issue-1',
    title: 'Hello',
    ownerId: null,
  },
]
allIssueRows

const issue = db.one('issues', { id: 'issue-1' })
type IssueRow = QueryValue<typeof issue>
const maybeIssue: IssueRow = undefined
maybeIssue

const issueWithComments = db.one('issues', {
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

const issueWithOwner = db.one('issues', {
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

const issueWithAssignedUsers = db.one('issues', {
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

db.one('memberships', { id: { issueId: 'issue-1', userId: 'user-1' } })

// @ts-expect-error table names come from the schema
db.all('missing')

// @ts-expect-error one-query id type comes from the primary key
db.one('issues', { id: 123 })

// @ts-expect-error composite primary keys require every key column
db.one('memberships', { id: { issueId: 'issue-1' } })

// @ts-expect-error include names come from schema.relationships.issues
db.one('issues', { id: 'issue-1', include: ['missingRelation'] })

// @ts-expect-error include requires a row id
db.one('issues', { include: ['comments'] })

db.one('memberships', {
  id: { issueId: 'issue-1', userId: 'user-1' },
  // @ts-expect-error memberships has no relationships in this schema
  include: ['issues'],
})
