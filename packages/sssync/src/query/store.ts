import type {
  ClientDatabaseSchema,
  Relationship,
  TableSchema,
} from '../schema/table-schema'
import type { Query, QueryPlan, QueryStore } from './types'

export function store<const S extends ClientDatabaseSchema>(
  schema: S,
): QueryStore<S> {
  const tableQueries = new Map<PropertyKey, unknown>()

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string' || !schema.tables[prop]) {
          return undefined
        }

        if (!tableQueries.has(prop)) {
          tableQueries.set(prop, createTableQuery(schema, prop))
        }

        return tableQueries.get(prop)
      },
    },
  ) as QueryStore<S>
}

function createTableQuery(schema: ClientDatabaseSchema, table: string) {
  return {
    all: () =>
      createQuery({
        key: table,
        plan: { kind: 'all', table },
      }),
    one: (id: unknown) =>
      createRowQuery(schema, table, {
        key: `${table}:${serializeId(schema.tables[table], id)}`,
        plan: { kind: 'one', table, id },
      }),
  }
}

function createQuery<T>(query: {
  readonly key: string
  readonly plan: QueryPlan
}): Query<T> {
  return query as Query<T>
}

function createRowQuery<T>(
  schema: ClientDatabaseSchema,
  table: string,
  query: {
    readonly key: string
    readonly plan: QueryPlan
  },
): Query<T> {
  const relations = new Map<PropertyKey, unknown>()
  const descriptor = createQuery<T>(query)

  return new Proxy(descriptor, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver)
      }

      if (typeof prop !== 'string') {
        return undefined
      }

      const relationship = schema.relationships[table]?.[prop]
      if (!relationship) {
        return undefined
      }

      if (!relations.has(prop)) {
        relations.set(
          prop,
          createRelationQuery(schema, table, prop, relationship, query),
        )
      }

      return relations.get(prop)
    },
  }) as Query<T>
}

function createRelationQuery(
  schema: ClientDatabaseSchema,
  sourceTable: string,
  relation: string,
  relationship: Relationship,
  parent: {
    readonly key: string
    readonly plan: QueryPlan
  },
) {
  const connection = lastConnection(relationship)
  const plan = {
    kind: 'relation' as const,
    parent: parent.plan,
    sourceTable,
    relation,
    destTable: connection.destSchema,
    cardinality: connection.cardinality,
    relationship,
  }
  const query = {
    key: `${parent.key}:${relation}`,
    plan,
  }

  if (connection.cardinality === 'one') {
    return createRowQuery(schema, connection.destSchema, query)
  }

  return createQuery(query)
}

function lastConnection(relationship: Relationship) {
  return relationship[relationship.length - 1]
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
