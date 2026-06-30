import { Result } from 'better-result'

import type { ErrorIssue } from './errors'
import { safeValidate } from './json-validator'
import type { Issue } from './json-validator'
import { rowSchemaFor } from './schema/row-schema'
import type { ClientDatabaseSchema } from './schema/table-schema'
import type { RowsByTable } from './store'

export type RowValidationProblem =
  | { readonly type: 'payload_not_object' }
  | { readonly type: 'unknown_model'; readonly model: string }
  | { readonly type: 'rows_not_array'; readonly model: string }
  | { readonly type: 'invalid_row'; readonly model: string; readonly issues: readonly ErrorIssue[] }

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
): Result<RowsByTable<S>, RowValidationProblem> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return Result.err({ type: 'payload_not_object' })
  }

  const rowsByTable: Record<string, Record<string, unknown>[]> = {}
  for (const [model, rows] of Object.entries(payload)) {
    const validator = validators[model]
    if (!validator) return Result.err({ type: 'unknown_model', model })

    if (!Array.isArray(rows)) return Result.err({ type: 'rows_not_array', model })

    const validatedRows: Record<string, unknown>[] = []
    for (const row of rows) {
      const result = safeValidate(validator, row)
      if (!result.success) {
        return Result.err({
          type: 'invalid_row',
          model,
          issues: result.issues.map(toErrorIssue),
        })
      }
      validatedRows.push(result.output)
    }

    rowsByTable[model] = validatedRows
  }

  return Result.ok(rowsByTable as unknown as RowsByTable<S>)
}

function toErrorIssue(issue: Issue): ErrorIssue {
  return {
    message: issue.message,
    ...(issue.path ? { path: issue.path.map(segment => (isPathSegment(segment) ? segment.key : segment)) } : {}),
  }
}

function isPathSegment(value: unknown): value is { readonly key: PropertyKey } {
  return value !== null && typeof value === 'object' && 'key' in value
}
