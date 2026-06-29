import type { SchemaValueToTSType } from './schema-value'
import type { ClientDatabaseSchema, TableSchema } from './table-schema'

/**
 * The full row type for a table, derived from its column definitions.
 */
export type RowOf<T extends TableSchema> = {
  [K in keyof T['columns']]: SchemaValueToTSType<T['columns'][K]>
}

/**
 * The primary-key portion of a row, used to target a single row.
 * Every primary-key column is required.
 */
export type IdOf<T extends TableSchema> = {
  [K in T['primaryKey'][number] & keyof RowOf<T>]: RowOf<T>[K]
}

export type IdInputOf<T extends TableSchema> = T['primaryKey'] extends readonly [infer K]
  ? K extends keyof RowOf<T>
    ? RowOf<T>[K]
    : never
  : IdOf<T>

/**
 * `ClientDatabaseSchema['tables']` carries a `[table: string]` index signature,
 * which would collapse `keyof` down to `string` and erase the concrete table
 * names. Remapping with `string extends K ? never : K` drops that catch-all key
 * and keeps only the literal table names from the built schema.
 */
export type Tables<S extends ClientDatabaseSchema> = {
  [K in keyof S['tables'] as string extends K ? never : K]: S['tables'][K]
}

export type TableName<S extends ClientDatabaseSchema> = keyof Tables<S> & string
