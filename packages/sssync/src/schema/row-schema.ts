import * as j from '../json-validator'
import type { SchemaValue, ValueType } from './schema-value'
import type { TableSchema } from './table-schema'

type RowValidator = j.Validator<Record<string, unknown>>

function baseSchemaFor(type: ValueType) {
  switch (type) {
    case 'string':
      return j.string()
    case 'number':
      return j.number()
    case 'boolean':
      return j.boolean()
    case 'null':
      return j.nullValue()
    case 'json':
      return j.unknown()
  }
}

function columnSchema(column: SchemaValue) {
  const base = baseSchemaFor(column.type)
  // `optional` columns are nullable (see SchemaValueToTSType).
  return column.optional ? j.nullable(base) : base
}

/**
 * Builds a validator for a single row of `table` from its write columns.
 * Unknown keys are ignored, so server rows may carry extra fields.
 */
export function rowSchemaFor(table: TableSchema): RowValidator {
  const entries = Object.entries(table.columns).map(([name, column]) => [name, columnSchema(column)] as const)
  return j.object(Object.fromEntries(entries))
}
