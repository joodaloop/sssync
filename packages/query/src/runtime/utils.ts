import type { TableSchema } from '@sssync/zero-schema'
import type { QuerySpec, Scalar } from '../types'
import type { RuntimeRow } from './types'

export function dedupeRows(table: TableSchema, rows: readonly RuntimeRow[]): RuntimeRow[] {
  const byId = new Map<string, RuntimeRow>()
  for (const row of rows) {
    byId.set(rowId(table, row), row)
  }
  return [...byId.values()]
}

export function rowId(table: TableSchema, row: RuntimeRow): string {
  return primaryKeyToId(table.primaryKey.map(key => row[key] as Scalar))
}

export function primaryKeyToId(id: Scalar | readonly Scalar[]): string {
  return Array.isArray(id) ? id.map(String).join('\0') : String(id)
}

export function fieldsKey(row: RuntimeRow, fields: readonly string[]): string {
  return tupleKey(fields.map(field => row[field]))
}

export function tupleKey(values: readonly unknown[]): string {
  return values.map(value => JSON.stringify(value)).join('\0')
}

export function addIndexEntry(index: Map<string, Set<string>>, key: string, id: string) {
  let ids = index.get(key)
  if (!ids) {
    ids = new Set()
    index.set(key, ids)
  }
  ids.add(id)
}

export function cloneIndexForKeys(
  index: Map<string, Set<string>>,
  keys: Iterable<string>,
): Map<string, Set<string>> {
  const clone = new Map<string, Set<string>>()
  for (const key of keys) {
    clone.set(key, new Set(index.get(key) ?? []))
  }
  return clone
}

export function sourceByDest(index: Map<string, Set<string>>): Map<string, string> {
  const sources = new Map<string, string>()
  for (const [sourceKey, destIds] of index) {
    for (const destId of destIds) {
      if (!sources.has(destId)) {
        sources.set(destId, sourceKey)
      }
    }
  }
  return sources
}

export function removeIndexEntry(index: Map<string, Set<string>>, key: string, id: string) {
  const ids = index.get(key)
  ids?.delete(id)
  if (ids?.size === 0) {
    index.delete(key)
  }
}

export function lookupMapKey(tableName: string, fields: readonly string[]): string {
  return `${tableName}\0${fields.join('\0')}`
}

export function rootTableFor(spec: QuerySpec): string {
  return spec.stages.find(stage => stage.type === 'related')?.sourceTable ?? spec.table
}
