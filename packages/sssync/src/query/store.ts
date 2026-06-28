import type { ClientDatabaseSchema } from '../schema/table-schema'
import type { Query, QueryPlan, QueryStore } from './types'
import { primaryKeyFor } from '../shared'

export function store<const S extends ClientDatabaseSchema>(
  schema: S,
): QueryStore<S> {
  return {
    all: (table: string) => {
      if (!schema.tables[table]) {
        throw new Error(`Unknown table "${table}"`)
      }

      return createQuery({
        key: table,
        accessKeys: [table],
        plan: { kind: 'all', table },
      })
    },
    one: (
      table: string,
      options: { id: unknown; include?: readonly string[] },
    ) => {
      if (!schema.tables[table]) {
        throw new Error(`Unknown table "${table}"`)
      }

      const include = options.include ?? []
      const baseKey = `${table}:${primaryKeyFor(
        schema.tables[table],
        options.id,
      )}`

      return createQuery({
        key: keyWithIncludes(baseKey, include),
        accessKeys: [
          baseKey,
          ...include.map(relation => `${baseKey}:${relation}`),
        ],
        plan: {
          kind: 'one',
          table,
          id: options.id,
          include,
        },
      })
    },
  } as QueryStore<S>
}

function createQuery<T>(query: {
  readonly key: string
  readonly accessKeys: readonly string[]
  readonly plan: QueryPlan
}): Query<T> {
  return query as Query<T>
}

function keyWithIncludes(baseKey: string, include: readonly string[]) {
  if (include.length === 0) {
    return baseKey
  }

  return `${baseKey}?include=${[...include].sort().join(',')}`
}
