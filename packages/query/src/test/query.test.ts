import { describe, expect, test } from 'bun:test'
import { column, relationships, table } from '@sssync/zero-schema'
import { query } from '../index'

const issuesTable = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    status: column.string(),
    priority: column.number(),
    ownerId: column.string(),
  })
  .primaryKey('id')

const commentsTable = table('comments')
  .columns({
    id: column.string(),
    issueId: column.string(),
    body: column.string(),
    status: column.string(),
  })
  .primaryKey('id')

const usersTable = table('users')
  .columns({
    id: column.string(),
    name: column.string(),
  })
  .primaryKey('id')

const issues = issuesTable.build()
const comments = commentsTable.build()
const users = usersTable.build()

const schema = {
  tables: {
    issues,
    comments,
    users,
  },
  relationships: {
    issues: relationships(issuesTable, ({ many, one }) => ({
      comments: many({
        sourceField: ['id'],
        destField: ['issueId'],
        destSchema: commentsTable,
      }),
      owner: one({
        sourceField: ['ownerId'],
        destField: ['id'],
        destSchema: usersTable,
      }),
    })).relationships,
    comments: relationships(commentsTable, ({ one }) => ({
      issue: one({
        sourceField: ['issueId'],
        destField: ['id'],
        destSchema: issuesTable,
      }),
    })).relationships,
    users: {},
  },
} as const

describe('query DSL', () => {
  test('builds chained where expressions for a table', () => {
    const spec = query(schema).issues
      .where(q => q.eq('status', 'open'))
      .where(q => q.gt('priority', 2))
      .toSpec()

    expect(spec).toEqual({
      table: 'issues',
      mode: { type: 'many' },
      stages: [
        {
          type: 'where',
          expression: {
            type: 'comparison',
            op: 'eq',
            field: 'status',
            value: 'open',
          },
        },
        {
          type: 'where',
          expression: {
            type: 'comparison',
            op: 'gt',
            field: 'priority',
            value: 2,
          },
        },
      ],
    })
  })

  test('builds logical where expressions', () => {
    const spec = query(schema).issues
      .where(q =>
        q.or(q.eq('status', 'open'), q.and(q.eq('ownerId', 'u1'), q.lt('priority', 3))),
      )
      .toSpec()

    expect(spec.stages).toHaveLength(1)
    expect(spec.stages[0]).toMatchObject({
      type: 'where',
      expression: {
        type: 'or',
      },
    })
  })

  test('related changes the query root and keeps relationship metadata', () => {
    const spec = query(schema).issues
      .where(q => q.eq('status', 'open'))
      .related('comments')
      .where(q => q.eq('status', 'visible'))
      .toSpec()

    expect(spec.table).toBe('comments')
    expect(spec.stages[1]).toMatchObject({
      type: 'related',
      name: 'comments',
      sourceTable: 'issues',
      targetTable: 'comments',
    })
    expect(spec.stages[2]).toMatchObject({
      type: 'where',
      expression: {
        field: 'status',
        value: 'visible',
      },
    })
  })

  test('single records an entity-shaped query mode', () => {
    const spec = query(schema).issues.single('i1').toSpec()

    expect(spec).toEqual({
      table: 'issues',
      mode: { type: 'single', id: 'i1' },
      stages: [],
    })
  })

  test('throws for unknown runtime relationships', () => {
    expect(() =>
      query(schema).issues.related(
        // @ts-expect-error testing the runtime guard
        'missing',
      ),
    ).toThrow('Unknown relationship "missing" on table "issues"')
  })
})
