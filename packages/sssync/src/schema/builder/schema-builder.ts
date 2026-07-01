import { panic } from 'better-result'

import { hasOwn, mapAllEntries } from '../../shared'
import type { ClientDatabaseSchema, Relationship, RelationshipsSchema, TableSchema } from '../table-schema'
import type { Relationships } from './relationship-builder'
import type { TableBuilderWithColumns } from './table-builder'

/**
 * Note: the keys of the `tables` and `relationships` parameters do not matter.
 * You can assign them to any value you like. E.g.,
 *
 * ```ts
 * createSchema({rsdfgafg: table('users')...}, {sdfd: relationships(users, ...)})
 * ```
 */
export function createSchema<
  const TTables extends readonly TableBuilderWithColumns<TableSchema>[],
  const TRelationships extends readonly Relationships[] = readonly [],
>(options: {
  readonly tables: TTables
  readonly relationships?: TRelationships | undefined
}): ClientDatabaseSchema & {
  tables: {
    readonly [K in TTables[number]['schema']['name']]: Extract<TTables[number]['schema'], { name: K }>
  }
  relationships: {
    readonly [K in TRelationships[number]['name']]: Extract<TRelationships[number], { name: K }>['relationships']
  }
} {
  const retTables: Record<string, TableSchema> = {}
  const retRelationships: Record<string, Record<string, Relationship>> = {}

  for (const table of options.tables) {
    if (hasOwn(retTables, table.schema.name)) {
      panic(`Table "${table.schema.name}" is defined more than once in the schema`)
    }
    retTables[table.schema.name] = table.build()
  }
  for (const relationships of options.relationships ?? []) {
    if (retRelationships[relationships.name]) {
      panic(`Relationships for table "${relationships.name}" are defined more than once in the schema`)
    }
    retRelationships[relationships.name] = relationships.relationships
    checkRelationship(relationships.relationships, relationships.name, retTables)
  }

  return {
    tables: retTables,
    relationships: retRelationships,
    hash: hashSchema({ tables: retTables, relationships: retRelationships }),
  } as any
}

function checkRelationship(
  relationships: Record<string, Relationship>,
  tableName: string,
  tables: Record<string, TableSchema>,
) {
  // TS should be able to check this for us but something is preventing it from happening.
  for (const [name, rel] of Object.entries(relationships)) {
    let source = tables[tableName]
    if (source.columns[name] !== undefined) {
      panic(
        `Relationship "${tableName}"."${name}" cannot have the same name as the column "${name}" on the the table "${source.name}"`,
      )
    }
    for (const connection of rel) {
      if (!tables[connection.destSchema]) {
        panic(
          `For relationship "${tableName}"."${name}", destination table "${connection.destSchema}" is missing in the schema`,
        )
      }
      if (!source.columns[connection.sourceField[0]]) {
        panic(
          `For relationship "${tableName}"."${name}", the source field "${connection.sourceField[0]}" is missing in the table schema "${source.name}"`,
        )
      }
      source = tables[connection.destSchema]
    }
  }
}

export function hashSchema(schema: {
  readonly tables: Record<string, TableSchema>
  readonly relationships?: Record<string, RelationshipsSchema> | undefined
  // An existing `hash` is accepted but ignored (see `normalizeForHash`), so a
  // full schema can be re-hashed without stripping its hash first.
  readonly hash?: string | undefined
}): string {
  const normalized = stableStringify({
    tables: schema.tables,
    relationships: schema.relationships ?? {},
  })
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < normalized.length; i++) {
    hash ^= BigInt(normalized.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(36)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForHash(value))
}

function normalizeForHash(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForHash)
  }
  const object = value as Record<string, unknown>
  return mapAllEntries(object, entries =>
    entries
      .filter(([key, val]) => key !== 'hash' && val !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => [key, normalizeForHash(val)]),
  )
}
