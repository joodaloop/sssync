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

const commentRelationships = relationships(comments, ({ one }) => ({
  issue: one({
    sourceField: ['issueId'],
    destField: ['id'],
    destSchema: issues,
  }),
}))

const userRelationships = relationships(users, ({ many }) => ({
  issues: many({
    sourceField: ['id'],
    destField: ['ownerId'],
    destSchema: issues,
  }),
}))

const schema = createSchema({
  tables: [issues, comments, users, memberships],
  relationships: [issueRelationships, commentRelationships, userRelationships],
})

const db = store(schema)

const allIssues = db.issues.all()
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

const issue = db.issues.one('issue-1')
type IssueRow = QueryValue<typeof issue>
const maybeIssue: IssueRow = undefined
maybeIssue

const commentsForIssue = db.issues.one('issue-1').comments
type CommentsForIssue = QueryValue<typeof commentsForIssue>
const commentRows: CommentsForIssue = [
  {
    id: 'comment-1',
    issueId: 'issue-1',
    body: 'Nice',
  },
]
commentRows

const owner = db.issues.one('issue-1').owner
type Owner = QueryValue<typeof owner>
const maybeOwner: Owner = { id: 'user-1', name: 'Ada' }
maybeOwner

const assignedUsers = db.issues.one('issue-1').assignedUsers
type AssignedUsers = QueryValue<typeof assignedUsers>
const assignedUserRows: AssignedUsers = [{ id: 'user-1', name: 'Ada' }]
assignedUserRows
const assignedUsersFirstHopDest: 'memberships' =
  assignedUsers.plan.relationship[0].destSchema
const assignedUsersSecondHopDest: 'users' =
  assignedUsers.plan.relationship[1].destSchema
assignedUsersFirstHopDest
assignedUsersSecondHopDest

const nestedComments = db.comments.one('comment-1').issue.comments
type NestedComments = QueryValue<typeof nestedComments>
const nestedCommentRows: NestedComments = []
nestedCommentRows

db.memberships.one({ issueId: 'issue-1', userId: 'user-1' })

// @ts-expect-error table names come from the schema
db.missing

// @ts-expect-error table query only exposes known methods
db.issues.missing()

// @ts-expect-error one() id type comes from the primary key
db.issues.one(123)

// @ts-expect-error composite primary keys require every key column
db.memberships.one({ issueId: 'issue-1' })

// @ts-expect-error relation names come from schema.relationships.issues
db.issues.one('issue-1').missingRelation

// @ts-expect-error all() returns a collection query, not a row query
db.issues.all().comments
