import type { SyncError } from './errors'
import { safeValidate } from './json-validator'
import type { TableName } from './schema/infer'
import { rowSchemaFor } from './schema/row-schema'
import type { ClientDatabaseSchema } from './schema/table-schema'
import type { LoadingStatus, Observable } from './shared'
import type { RowsByTable } from './store'

// Per-model bootstrap state.
export type BootstrapState = {
  readonly status: LoadingStatus
  readonly error?: string
}

// Bootstrap state keyed by model name.
export type BootstrapsSnapshot<S extends ClientDatabaseSchema> = Readonly<Partial<Record<TableName<S>, BootstrapState>>>

export type StatusChange<Name extends string = string> = {
  readonly name: Name
} & BootstrapState

type LoadResult = Promise<readonly unknown[] | undefined>
type Reporter = (error: SyncError) => void

export class Bootstrap<S extends ClientDatabaseSchema> {
  // One row validator per table, derived from the schema's write columns.
  private readonly rowValidators: Partial<Record<string, ReturnType<typeof rowSchemaFor>>>
  // In-flight loads keyed by model. Recorded synchronously in `load` so
  // concurrent calls share one fetch before consulting the bootstrap registry.
  private readonly inflight = new Map<string, LoadResult>()

  constructor(
    private readonly schema: S,
    private readonly bootstrapURL: string,
    private readonly bootstraps: Observable<BootstrapsSnapshot<S>>,
    private readonly addIfNotExist: (rowsByTable: RowsByTable<S>) => void = () => {},
    private readonly report: Reporter = () => {},
  ) {
    this.rowValidators = Object.fromEntries(
      Object.entries(schema.tables).map(([name, table]) => [name, rowSchemaFor(table)]),
    )
  }

  // Fetches every row for `modelName` via `GET /bootstrap?model=<name>`,
  // expecting `{ data: rows[] }`. Concurrent loads for the same model share one
  // in-flight request and resolve to the same rows. Returns undefined for an
  // unknown model or one already satisfied per the bootstrap registry.
  //
  // Synchronous on purpose: the in-flight lookup happens before any await, so
  // two back-to-back calls can't both get past it.
  load = (modelName: string): LoadResult => {
    const existing = this.inflight.get(modelName)
    if (existing) return existing

    const validator = this.rowValidators[modelName]
    if (!validator) {
      this.report({
        type: 'bootstrap.unknown_model',
        model: modelName,
      })
      this.changeStatus({
        name: modelName,
        status: 'error',
        error: `Unknown model "${modelName}"`,
      })
      return Promise.resolve(undefined)
    }

    const run = this.run(modelName, validator)
    this.inflight.set(modelName, run)
    return run.finally(() => this.inflight.delete(modelName))
  }

  private async run(
    modelName: string,
    validator: ReturnType<typeof rowSchemaFor>,
  ): Promise<readonly unknown[] | undefined> {
    // Skip if already bootstrapped ('success') or being bootstrapped by another
    // session/tab ('pending'); the in-flight map handles same-instance dedupe.
    const existing = this.bootstraps.get()[modelName as TableName<S>]?.status
    if (existing === 'success' || existing === 'pending') return undefined

    this.changeStatus({ name: modelName, status: 'pending' })

    const url = `${this.bootstrapURL}?model=${encodeURIComponent(modelName)}`
    let res: Response
    try {
      res = await fetch(url)
    } catch (error) {
      this.report({
        type: 'bootstrap.fetch_failed',
        model: modelName,
        url,
        cause: errorCause(error),
      })
      this.changeStatus({ name: modelName, status: 'error', error: errorMessage(error) })
      return undefined
    }

    if (!res.ok) {
      this.report({
        type: 'bootstrap.http_failed',
        model: modelName,
        response: {
          status: res.status,
          statusText: res.statusText,
          url: res.url || url,
        },
      })
      this.changeStatus({
        name: modelName,
        status: 'error',
        error: `Bootstrap fetch failed: ${res.status} ${res.statusText}`,
      })
      return undefined
    }

    let payload: unknown
    try {
      payload = await res.json()
    } catch (error) {
      this.report({
        type: 'validation.invalid_json',
        context: 'bootstrap_response',
        cause: errorCause(error),
      })
      this.changeStatus({ name: modelName, status: 'error', error: errorMessage(error) })
      return undefined
    }

    const result = validateData(modelName, payload, validator)
    if (!result.success) {
      this.report(result.error)
      this.changeStatus({ name: modelName, status: 'error', error: result.message })
      return undefined
    }

    this.addIfNotExist(rowsByTableFor<S>(modelName, result.rows))
    this.changeStatus({ name: modelName, status: 'success' })
    return result.rows
  }

  private changeStatus(change: StatusChange): void {
    this.bootstraps.set({
      ...this.bootstraps.get(),
      [change.name]: {
        status: change.status,
        ...(change.error === undefined ? {} : { error: change.error }),
      },
    })
  }
}

// Validates the `{ data: rows[] }` payload, returning the rows when every one
// matches `validator`.
function validateData(
  modelName: string,
  payload: unknown,
  validator: ReturnType<typeof rowSchemaFor>,
):
  | { readonly success: true; readonly rows: readonly Record<string, unknown>[] }
  | { readonly success: false; readonly error: SyncError; readonly message: string } {
  if (payload === null || typeof payload !== 'object' || !('data' in payload)) {
    return {
      success: false,
      error: { type: 'bootstrap.response_missing_data', model: modelName },
      message: 'Bootstrap response had no "data" array',
    }
  }

  const { data } = payload as { data: unknown }
  if (!Array.isArray(data)) {
    return {
      success: false,
      error: { type: 'bootstrap.response_data_not_array', model: modelName },
      message: 'Bootstrap response "data" was not an array',
    }
  }

  const rows: Record<string, unknown>[] = []
  for (const row of data) {
    const result = safeValidate(validator, row)
    if (!result.success) {
      const message = result.issues.map(issue => issue.message).join('; ')
      return {
        success: false,
        error: {
          type: 'bootstrap.invalid_row',
          model: modelName,
          issues: result.issues.map(issue => ({
            message: issue.message,
            ...(issue.path
              ? { path: issue.path.map(segment => (isPathSegment(segment) ? segment.key : segment)) }
              : {}),
          })),
        },
        message: `Invalid row: ${message}`,
      }
    }
    rows.push(result.output)
  }

  return { success: true, rows }
}

function rowsByTableFor<S extends ClientDatabaseSchema>(
  tableName: string,
  rows: readonly Record<string, unknown>[],
): RowsByTable<S> {
  return { [tableName]: rows } as RowsByTable<S>
}

function errorCause(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    }
  }
  return { message: String(error) }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPathSegment(value: unknown): value is { readonly key: PropertyKey } {
  return value !== null && typeof value === 'object' && 'key' in value
}
