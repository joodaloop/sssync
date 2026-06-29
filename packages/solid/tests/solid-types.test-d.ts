import { defineMutators } from '@sssync/sssync/mutators'
import type { QueryValue } from '@sssync/sssync/query'
import { column, createSchema, relationships, table } from '@sssync/sssync/schema'
import { SSSync } from '@sssync/sssync/sssync'

import { createSSSContext } from '../src'

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

const issueRelationships = relationships(issues, ({ many }) => ({
  comments: many({
    sourceField: ['id'],
    destField: ['issueId'],
    destSchema: comments,
  }),
}))

const schema = createSchema({
  tables: [issues, comments],
  relationships: [issueRelationships],
})

const mutators = defineMutators(schema, () => ({}))

const sync = new SSSync({
  schema,
  mutators,
  batchURL: '/batch',
  bootstrapURL: '/bootstrap',
  storage: null,
})

// `.all` and `.one` are fully typed straight off the instance.
const allIssuesQuery = sync.all('issues')
const allIssues: readonly {
  id: string
  title: string
  ownerId: string | null
}[] = null as unknown as QueryValue<typeof allIssuesQuery>
allIssues

// --- createSSSContext returns a typed provider/hook set ---------------------

const main = createSSSContext({
  schema,
  mutators,
  batchURL: '/batch',
  bootstrapURL: '/bootstrap',
  storage: null,
})
const typed = main.useSSS()

const issueWithCommentsQuery = typed().one('issues', {
  id: 'issue-1',
  relations: ['comments'],
})
const maybeIssueWithComments:
  | {
      id: string
      title: string
      ownerId: string | null
      comments: readonly {
        id: string
        issueId: string
        body: string
      }[]
    }
  | undefined = null as unknown as QueryValue<typeof issueWithCommentsQuery>
maybeIssueWithComments

// @ts-expect-error table names come from the context schema
typed().all('missing')

// @ts-expect-error relation names come from schema.relationships.issues
typed().one('issues', { id: 'issue-1', relations: ['missingRelation'] })

const [issueRows, issueRowsDetails] = main.useAll('issues')
const issueRowsValue: readonly {
  id: string
  title: string
  ownerId: string | null
}[] = issueRows()
issueRowsValue
issueRowsDetails().status

const [issueWithComments] = main.useOne('issues', {
  id: 'issue-1',
  relations: ['comments'],
})
const issueWithCommentsValue:
  | {
      id: string
      title: string
      ownerId: string | null
      comments: readonly {
        id: string
        issueId: string
        body: string
      }[]
    }
  | undefined = issueWithComments()
issueWithCommentsValue

// @ts-expect-error useAll table names come from the context schema
main.useAll('missing')

main.useOne('issues', {
  id: 'issue-1',
  // @ts-expect-error useOne relation names come from the context schema
  relations: ['missingRelation'],
})

const users = table('users')
  .columns({
    id: column.string(),
    name: column.string(),
  })
  .primaryKey('id')

const adminSchema = createSchema({
  tables: [users],
})

const adminMutators = defineMutators(adminSchema, () => ({}))
const admin = createSSSContext({
  schema: adminSchema,
  mutators: adminMutators,
  batchURL: '/batch',
  bootstrapURL: '/bootstrap',
  storage: null,
})

const [usersValue] = admin.useAll('users')
const usersRows: readonly {
  id: string
  name: string
}[] = usersValue()
usersRows

// @ts-expect-error useAll keeps separate schema types
main.useAll('users')
