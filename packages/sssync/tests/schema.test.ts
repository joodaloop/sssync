import { describe, expect, test } from 'bun:test'
import {
  column,
  createSchema,
  hashSchema,
  relationships,
  table,
} from '../src/schema'

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    status: column.string(),
    priority: column.number(),
    ownerId: column.string().optional(),
  })
  .primaryKey('id')

const comments = table('comments')
  .columns({
    id: column.string(),
    issueId: column.string(),
    body: column.string(),
    visible: column.boolean(),
  })
  .primaryKey('id')

const users = table('users')
  .columns({
    id: column.string(),
    name: column.string(),
    metadata: column.json().optional(),
  })
  .primaryKey('id')

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

describe('schema builder', () => {
  test('creates the expected table, column, relationship, and hash shape', () => {
    const schema = createSchema({
      tables: [issues, comments, users],
      relationships: [issueRelationships],
    })

    // `customType` is typed as the base type (e.g. `string`) so that
    // `SchemaValueToTSType` can extract custom column types, but the builder
    // stores `null` at runtime. Assert the runtime shape with the static type
    // loosened to avoid that intentional divergence.
    expect(schema.tables.issues as unknown).toEqual({
      name: 'issues',
      columns: {
        id: { type: 'string', optional: false, customType: null },
        title: { type: 'string', optional: false, customType: null },
        status: { type: 'string', optional: false, customType: null },
        priority: { type: 'number', optional: false, customType: null },
        ownerId: { type: 'string', optional: true, customType: null },
      },
      primaryKey: ['id'],
    })
    expect(schema.relationships.issues.comments).toEqual([
      {
        sourceField: ['id'],
        destField: ['issueId'],
        destSchema: 'comments',
        cardinality: 'many',
      },
    ])
    expect(schema.relationships.issues.owner).toEqual([
      {
        sourceField: ['ownerId'],
        destField: ['id'],
        destSchema: 'users',
        cardinality: 'one',
      },
    ])
    expect(schema.hash).toBeString()
    expect(schema.hash.length).toBeGreaterThan(0)
  })

  test('supports two-hop relationships', () => {
    const memberships = table('memberships')
      .columns({
        issueId: column.string(),
        userId: column.string(),
      })
      .primaryKey('issueId', 'userId')

    const issueUsers = relationships(issues, ({ many }) => ({
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
      tables: [issues, memberships, users],
      relationships: [issueUsers],
    })

    expect(schema.relationships.issues.assignedUsers).toEqual([
      {
        sourceField: ['id'],
        destField: ['issueId'],
        destSchema: 'memberships',
        cardinality: 'many',
      },
      {
        sourceField: ['userId'],
        destField: ['id'],
        destSchema: 'users',
        cardinality: 'many',
      },
    ])
  })
})

describe('schema hashing', () => {
  test('is stable for equivalent schema objects and ignores an existing hash', () => {
    const schema = createSchema({
      tables: [issues, comments],
      relationships: [
        relationships(issues, ({ many }) => ({
          comments: many({
            sourceField: ['id'],
            destField: ['issueId'],
            destSchema: comments,
          }),
        })),
      ],
    })

    expect(hashSchema(schema)).toBe(schema.hash)
    expect(hashSchema({ ...schema, hash: 'stale' })).toBe(schema.hash)
    expect(
      createSchema({
        tables: [issues, comments],
        relationships: [
          relationships(issues, ({ many }) => ({
            comments: many({
              sourceField: ['id'],
              destField: ['issueId'],
              destSchema: comments,
            }),
          })),
        ],
      }).hash,
    ).toBe(schema.hash)
  })

  test('changes when the schema changes', () => {
    const base = createSchema({ tables: [issues] })
    const changed = createSchema({
      tables: [
        table('issues')
          .columns({
            id: column.string(),
            title: column.string(),
            status: column.string(),
            priority: column.string(),
            ownerId: column.string().optional(),
          })
          .primaryKey('id'),
      ],
    })

    expect(changed.hash).not.toBe(base.hash)
  })
})

describe('schema validation', () => {
  test('throws when primaryKey is not called before createSchema', () => {
    expect(() =>
      createSchema({
        tables: [
          table('missingPrimaryKey').columns({
            id: column.string(),
          }),
        ],
      }),
    ).toThrow('Table "missingPrimaryKey" is missing a primary key')
  })

  test('throws when a table is defined more than once', () => {
    expect(() =>
      createSchema({
        tables: [issues, issues],
      }),
    ).toThrow('Table "issues" is defined more than once in the schema')
  })

  test('throws when relationships are defined more than once for a table', () => {
    const commentsAgain = relationships(issues, ({ many }) => ({
      comments: many({
        sourceField: ['id'],
        destField: ['issueId'],
        destSchema: comments,
      }),
    }))

    expect(() =>
      createSchema({
        tables: [issues, comments, users],
        relationships: [issueRelationships, commentsAgain],
      }),
    ).toThrow(
      'Relationships for table "issues" are defined more than once in the schema',
    )
  })

  test('throws when a relationship points to a missing destination table', () => {
    expect(() =>
      createSchema({
        tables: [issues],
        relationships: [
          relationships(issues, ({ many }) => ({
            comments: many({
              sourceField: ['id'],
              destField: ['issueId'],
              destSchema: comments,
            }),
          })),
        ],
      }),
    ).toThrow(
      'For relationship "issues"."comments", destination table "comments" is missing in the schema',
    )
  })

  test('throws when relationship names collide with column names', () => {
    expect(() =>
      createSchema({
        tables: [issues, comments],
        relationships: [
          relationships(issues, ({ many }) => ({
            title: many({
              sourceField: ['id'],
              destField: ['issueId'],
              destSchema: comments,
            }),
          })),
        ],
      }),
    ).toThrow(
      'Relationship "issues"."title" cannot have the same name as the column "title" on the the table "issues"',
    )
  })
})
