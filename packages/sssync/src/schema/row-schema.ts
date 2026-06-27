import * as v from 'valibot'

import type { SchemaValue, ValueType } from './schema-value'
import type { TableSchema } from './table-schema'

type RowValidator = v.GenericSchema<Record<string, unknown>>

function baseSchemaFor(type: ValueType) {
  switch (type) {
    case 'string':
      return v.string()
    case 'number':
      return v.number()
    case 'boolean':
      return v.boolean()
    case 'null':
      return v.null()
    case 'json':
      return v.unknown()
  }
}

function columnSchema(column: SchemaValue) {
  const base = baseSchemaFor(column.type)
  // `optional` columns are nullable (see SchemaValueToTSType).
  return column.optional ? v.nullable(base) : base
}

/**
 * Builds a validator for a single row of `table` from its write columns.
 * Unknown keys are ignored, so server rows may carry extra fields.
 */
export function rowSchemaFor(table: TableSchema): RowValidator {
  const entries = Object.entries(table.columns).map(
    ([name, column]) => [name, columnSchema(column)] as const,
  )
  return v.object(Object.fromEntries(entries))
}
