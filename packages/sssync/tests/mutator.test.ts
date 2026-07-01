import { describe, expect, test } from 'bun:test'

import { Result } from 'better-result'
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
    const parsed = mutators.parse({
      name: 'updateIssueTitle',
      args: {
        id: 'issue-1',
        title: 'New title',
      },
    })

    expect(Result.isOk(parsed)).toBe(true)
    if (Result.isOk(parsed)) {
      expect(parsed.value).toEqual({
        name: 'updateIssueTitle',
        args: {
          id: 'issue-1',
          title: 'New title',
        },
      })
    }
  })

  test('rejects unknown mutation names', () => {
    const parsed = mutators.parse({
      name: 'missingMutator',
      args: {},
    })

    expect(Result.isError(parsed)).toBe(true)
    if (Result.isError(parsed)) {
      expect(parsed.error).toEqual({ type: 'mutator', offending: 'missingMutator' })
    }
  })

  test('applies a mutator and collects optimistic table mutations', async () => {
    const parsed = mutators.parse({
      name: 'updateIssueTitle',
      args: {
        id: 'issue-1',
        title: 'New title',
      },
    })
    expect(Result.isOk(parsed)).toBe(true)
    if (!Result.isOk(parsed)) return

    const mutations = await mutators.apply(parsed.value)

    expect(Result.isOk(mutations)).toBe(true)
    if (Result.isOk(mutations)) {
      expect(mutations.value).toEqual([
        {
          type: 'UPDATE',
          table: 'issues',
          id: { id: 'issue-1' },
          changes: { title: 'New title' },
        },
      ])
    }
  })

  test('snapshots update changes when collecting mutations', async () => {
    const parsed = mutators.parse({
      name: 'mutateSharedChangesObject',
      args: {
        id: 'issue-1',
      },
    })
    expect(Result.isOk(parsed)).toBe(true)
    if (!Result.isOk(parsed)) return

    const mutations = await mutators.apply(parsed.value)

    expect(Result.isOk(mutations)).toBe(true)
    if (Result.isOk(mutations)) {
      expect(mutations.value).toEqual([
        {
          type: 'UPDATE',
          table: 'issues',
          id: { id: 'issue-1' },
          changes: { title: 'Initial title' },
        },
      ])
    }
  })
})
