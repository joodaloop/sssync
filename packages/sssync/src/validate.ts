import type { Failure } from './errors'
import { safeValidate } from './json-validator'
import { err, ok, type Result } from './result'
import { rowSchemaFor } from './schema/row-schema'
import type { ClientDatabaseSchema } from './schema/table-schema'
import type { RowsByTable } from './store'

/**
 * Validates a `{ [table]: rows }` payload, returning the normalized rows or a
 * validation {@link Failure}. The sync core builds one of these and shares it
 * across every path that ingests rows — network batches, bootstraps, and
 * persisted reads — so they all enforce the same write schema.
 */
export type ValidatePayload<S extends ClientDatabaseSchema> = (payload: unknown) => Result<RowsByTable<S>, Failure>

export function rowValidatorsFor(
  schema: ClientDatabaseSchema,
): Partial<Record<string, ReturnType<typeof rowSchemaFor>>> {
  const validators: Partial<Record<string, ReturnType<typeof rowSchemaFor>>> = {}

  for (const [name, table] of Object.entries(schema.tables)) {
    validators[name] = rowSchemaFor(table)
  }

  return validators
}

export function validateRowsByTable<S extends ClientDatabaseSchema>(
  payload: unknown,
  validators: Partial<Record<string, ReturnType<typeof rowSchemaFor>>>,
): Result<RowsByTable<S>, Failure> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return err({ type: 'validation', offending: payload })
  }

  const rowsByTable: Record<string, Record<string, unknown>[]> = {}
  for (const [model, rows] of Object.entries(payload)) {
    const validator = validators[model]
    if (!validator) return err({ type: 'validation', offending: model })

    if (!Array.isArray(rows)) return err({ type: 'validation', offending: rows })

    const validatedRows: Record<string, unknown>[] = []
    for (const row of rows) {
      const result = safeValidate(validator, row)
      if (!result.ok) {
        return err({ type: 'validation', offending: row })
      }
      validatedRows.push(result.value)
    }

    rowsByTable[model] = validatedRows
  }

  return ok(rowsByTable as unknown as RowsByTable<S>)
}
