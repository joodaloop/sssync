import { describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import { defineMutators } from '../src/mutators'
import { column, createSchema, table } from '../src/schema'

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    status: column.enumeration<'open' | 'closed'>(),
    priority: column.number(),
  })
  .primaryKey('id')

const schema = createSchema({ tables: [issues] })

const mutators = defineMutators(schema, defineMutator => ({
  updateIssueTitle: defineMutator(
    v.object({
      id: v.string(),
      title: v.string(),
    }),
    ({ tx, args }) => {
      if (args.title.length > 100) {
        throw new Error('Title is too long')
      }

      tx.mutate.issues.update(args.id, { title: args.title })
    },
  ),
  mutateSharedChangesObject: defineMutator(
    v.object({
      id: v.string(),
    }),
    ({ tx, args }) => {
      const changes = { title: 'Initial title' }
      tx.mutate.issues.update(args.id, changes)
      changes.title = 'Mutated title'
    },
  ),
}))

describe('mutators', () => {
  test('parses a mutation envelope using the named mutator schema', () => {
    expect(
      mutators.parse({
        name: 'updateIssueTitle',
        args: {
          id: 'issue-1',
          title: 'New title',
        },
      }),
    ).toEqual({
      name: 'updateIssueTitle',
      args: {
        id: 'issue-1',
        title: 'New title',
      },
    })
  })

  test('rejects unknown mutation names', () => {
    expect(() =>
      mutators.parse({
        name: 'missingMutator',
        args: {},
      }),
    ).toThrow('Unknown mutation "missingMutator"')
  })

  test('applies a mutator and collects optimistic table mutations', async () => {
    const envelope = mutators.parse({
      name: 'updateIssueTitle',
      args: {
        id: 'issue-1',
        title: 'New title',
      },
    })
    const mutations = await mutators.apply(envelope)

    expect(mutations).toEqual([
      {
        type: 'UPDATE',
        table: 'issues',
        id: { id: 'issue-1' },
        changes: { title: 'New title' },
      },
    ])
  })

  test('snapshots update changes when collecting mutations', async () => {
    const envelope = mutators.parse({
      name: 'mutateSharedChangesObject',
      args: {
        id: 'issue-1',
      },
    })
    const mutations = await mutators.apply(envelope)

    expect(mutations).toEqual([
      {
        type: 'UPDATE',
        table: 'issues',
        id: { id: 'issue-1' },
        changes: { title: 'Initial title' },
      },
    ])
  })
})
