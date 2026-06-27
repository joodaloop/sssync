import type {
  ClientDatabaseSchema,
  TableSchema,
} from '../schema/table-schema'
import type { Query, QueryPlan, QueryStore } from './types'

export function store<const S extends ClientDatabaseSchema>(
  schema: S,
): QueryStore<S> {
  return {
    query: (
      table: string,
      options?: { id: unknown; include?: readonly string[] },
    ) => {
      if (!schema.tables[table]) {
        throw new Error(`Unknown table "${table}"`)
      }

      if (!options) {
        return createQuery({
          key: table,
          accessKeys: [table],
          plan: { kind: 'all', table },
        })
      }

      const include = options.include ?? []
      const baseKey = `${table}:${serializeId(schema.tables[table], options.id)}`

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

function serializeId(table: TableSchema, id: unknown): string {
  if (table.primaryKey.length === 1) {
    return serializeKeyPart(id)
  }

  const idObject = id as Record<string, unknown>
  return table.primaryKey
    .map(field => `${field}=${serializeKeyPart(idObject[field])}`)
    .join(',')
}

function serializeKeyPart(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
