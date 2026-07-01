import * as v from 'valibot'

import { defineMutators } from '../src/mutators'
import type { MutationEnvelope } from '../src/mutators'
import { column, createSchema, table } from '../src/schema'

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    status: column.enumeration<'open' | 'closed'>(),
    priority: column.number(),
  })
  .primaryKey('id')

const memberships = table('memberships')
  .columns({
    issueId: column.string(),
    userId: column.string(),
    role: column.enumeration<'admin' | 'member'>(),
  })
  .primaryKey('issueId', 'userId')

const schema = createSchema({ tables: [issues, memberships] })

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
  createMembership: defineMutator(
    v.object({
      issueId: v.string(),
      userId: v.string(),
      role: v.picklist(['admin', 'member']),
    }),
    ({ tx, args }) => {
      tx.mutate.memberships.insert({ issueId: args.issueId, userId: args.userId }, { role: args.role })
    },
  ),
}))

type Envelope = MutationEnvelope<typeof mutators>

const updateEnvelope: Envelope = {
  name: 'updateIssueTitle',
  args: {
    id: 'issue-1',
    title: 'hello',
  },
}
updateEnvelope

const membershipEnvelope: Envelope = {
  name: 'createMembership',
  args: {
    issueId: 'issue-1',
    userId: 'user-1',
    role: 'member',
  },
}
membershipEnvelope

const parsed = mutators.parse({
  name: 'updateIssueTitle',
  args: { id: 'issue-1', title: 'hello' },
})

// @ts-expect-error apply accepts a parsed envelope, not separate name and args
void mutators.apply('updateIssueTitle', { id: 'issue-1', title: 'hello' })

if (parsed.ok) {
  void mutators.apply(parsed.value)

  switch (parsed.value.name) {
    case 'updateIssueTitle': {
      const title: string = parsed.value.args.title
      title
      break
    }
    case 'createMembership': {
      const role: 'admin' | 'member' = parsed.value.args.role
      role
      break
    }
  }
}

defineMutators(schema, defineMutator => ({
  badColumn: defineMutator(v.object({ id: v.string() }), ({ tx, args }) => {
    // @ts-expect-error 'missing' is not a column on issues
    tx.mutate.issues.update(args.id, { missing: true })
  }),
}))

defineMutators(schema, defineMutator => ({
  badPrimaryKeyUpdate: defineMutator(v.object({ id: v.string() }), ({ tx, args }) => {
    // @ts-expect-error update changes must not include primary-key columns
    tx.mutate.issues.update(args.id, { id: 'new-id' })
  }),
}))

defineMutators(schema, defineMutator => ({
  badCompositeId: defineMutator(v.object({ issueId: v.string() }), ({ tx, args }) => {
    // @ts-expect-error composite primary keys require every key column
    tx.mutate.memberships.remove({ issueId: args.issueId })
  }),
}))

const badEnvelope: Envelope = {
  name: 'updateIssueTitle',
  args: {
    id: 'issue-1',
    // @ts-expect-error updateIssueTitle.title must be a string
    title: 123,
  },
}
badEnvelope
