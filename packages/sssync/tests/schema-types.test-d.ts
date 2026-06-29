import { column, createSchema, relationships, table, type SchemaValueToTSType } from '../src/schema'

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    priority: column.number(),
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

const states = table('states')
  .columns({
    id: column.string(),
    status: column.enumeration<'open' | 'closed'>(),
  })
  .primaryKey('id')

const memberships = table('memberships')
  .columns({
    issueId: column.string(),
    userId: column.string(),
  })
  .primaryKey('issueId', 'userId')

table('bad_primary_key')
  .columns({
    id: column.string(),
  })
  // @ts-expect-error primary key must be an existing column
  .primaryKey('missing')

relationships(issues, ({ many }) => ({
  comments: many({
    // @ts-expect-error source field must be a source table column
    sourceField: ['missing'],
    destField: ['issueId'],
    destSchema: comments,
  }),
}))

relationships(issues, ({ many }) => ({
  comments: many({
    sourceField: ['id'],
    // @ts-expect-error destination field must be a destination table column
    destField: ['missing'],
    destSchema: comments,
  }),
}))

relationships(issues, ({ many }) => ({
  assignedUsers: many(
    {
      sourceField: ['id'],
      destField: ['issueId'],
      destSchema: memberships,
    },
    {
      // @ts-expect-error second hop source must be a junction table column
      sourceField: ['ownerId'],
      destField: ['id'],
      destSchema: users,
    },
  ),
}))

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
}))

const schema = createSchema({
  tables: [issues, comments, users],
  relationships: [issueRelationships],
})

const issueTableName: 'issues' = schema.tables.issues.name
issueTableName

const priorityType: 'number' = schema.tables.issues.columns.priority.type
priorityType

const commentsDest: 'comments' = schema.relationships.issues.comments[0].destSchema
commentsDest

type RequiredTitle = SchemaValueToTSType<typeof schema.tables.issues.columns.title>
const title: RequiredTitle = 'hello'
title

type OptionalOwnerId = SchemaValueToTSType<typeof schema.tables.issues.columns.ownerId>
const ownerId: OptionalOwnerId = null
ownerId

type Status = SchemaValueToTSType<typeof states.schema.columns.status>
const status: Status = 'open'
status

// @ts-expect-error enumeration columns only accept the provided string union
const badStatus: Status = 'archived'
badStatus

// @ts-expect-error required string columns do not include null
const badTitle: RequiredTitle = null
badTitle

// @ts-expect-error number columns do not accept strings
const badPriority: SchemaValueToTSType<typeof schema.tables.issues.columns.priority> = 'high'
badPriority
