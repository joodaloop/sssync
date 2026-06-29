import * as v from 'valibot'
import { defineMutators } from '../src/mutators'
import { column, createSchema, table } from '../src/schema'
import { Stats } from '../src/stats'
import { Observable } from '../src/shared'
import type { BootstrapsSnapshot } from '../src/bootstrap'

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
  })
  .primaryKey('id')

const comments = table('comments')
  .columns({
    id: column.string(),
    issueId: column.string(),
    body: column.string(),
  })
  .primaryKey('id')

const schema = createSchema({ tables: [issues, comments] })

const mutators = defineMutators(schema, defineMutator => ({
  updateIssueTitle: defineMutator(
    v.object({
      id: v.string(),
      title: v.string(),
    }),
    ({ tx, args }) => {
      tx.mutate.issues.update(args.id, { title: args.title })
    },
  ),
}))

const bootstrapRegistry = new Observable<BootstrapsSnapshot<typeof schema>>({})

const stats = new Stats({ bootstraps: bootstrapRegistry, mutators })

const bootstraps = stats.bootstraps.get()

// @ts-expect-error bootstrap snapshots are readonly
bootstraps.issues = {
  status: 'success',
}

const issueStatus = bootstraps.issues?.status
issueStatus

// @ts-expect-error bootstraps are keyed by schema table names
bootstraps.users

const queue = stats.mutationQueue.get()

const first = queue[0]

if (first?.name === 'updateIssueTitle') {
  const title: string = first.args.title
  title
}

// @ts-expect-error mutation queue snapshots are readonly
queue.push({
  name: 'updateIssueTitle',
  args: { id: 'issue-1', title: 'hello' },
})

const badQueueItem = {
  // @ts-expect-error mutation names come from the supplied mutators
  name: 'deleteIssue',
  args: { id: 'issue-1', title: 'hello' },
} satisfies (typeof queue)[number]
badQueueItem
