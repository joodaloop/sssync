import { Result } from 'better-result'

import type { SyncError } from './errors'
import type { TableName } from './schema/infer'
import type { ClientDatabaseSchema } from './schema/table-schema'
import type { LoadingStatus, Observable } from './shared'
import type { RowsByTable } from './store'
import { rowValidatorsFor, validateRowsByTable } from './validate'
import type { RowValidationProblem, RowValidator } from './validate'

export type BootstrapStatus = LoadingStatus

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
  private readonly rowValidators: Partial<Record<string, RowValidator>>
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
    this.rowValidators = rowValidatorsFor(schema)
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

    const run = this.run(modelName)
    this.inflight.set(modelName, run)
    return run.finally(() => this.inflight.delete(modelName))
  }

  private async run(modelName: string): Promise<readonly unknown[] | undefined> {
    // Skip if already bootstrapped ('success') or being bootstrapped by another
    // session/tab ('pending'); the in-flight map handles same-instance dedupe.
    const existing = this.bootstraps.get()[modelName as TableName<S>]?.status
    if (existing === 'success' || existing === 'pending') return undefined

    this.changeStatus({ name: modelName, status: 'pending' })

    const result = await this.fetchRows(modelName)
    if (Result.isError(result)) return this.fail(modelName, result.error)

    this.addIfNotExist(result.value)
    this.changeStatus({ name: modelName, status: 'success' })
    return result.value[modelName as TableName<S>] ?? []
  }

  private async fetchRows(modelName: string): Promise<Result<RowsByTable<S>, SyncError>> {
    const url = `${this.bootstrapURL}?model=${encodeURIComponent(modelName)}`
    const response = await Result.tryPromise({
      try: () => fetch(url),
      catch: error =>
        ({
          type: 'bootstrap.fetch_failed',
          model: modelName,
          url,
          cause: errorCause(error),
        }) satisfies SyncError,
    })

    if (Result.isError(response)) return Result.err(response.error)

    if (!response.value.ok) {
      return Result.err({
        type: 'bootstrap.http_failed',
        model: modelName,
        response: {
          status: response.value.status,
          statusText: response.value.statusText,
          url: response.value.url || url,
        },
      })
    }

    const payload = await Result.tryPromise({
      try: () => response.value.json() as Promise<unknown>,
      catch: error =>
        ({
          type: 'validation.invalid_json',
          context: 'bootstrap_response',
          cause: errorCause(error),
        }) satisfies SyncError,
    })

    if (Result.isError(payload)) return Result.err(payload.error)

    return validateRowsByTable<S>(payload.value, this.rowValidators).mapError(problem =>
      bootstrapErrorForProblem(modelName, problem),
    )
  }

  private fail(modelName: string, error: SyncError): undefined {
    this.report(error)
    this.changeStatus({ name: modelName, status: 'error', error: messageFor(error) })
    return undefined
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

function bootstrapErrorForProblem(requestedModel: string, problem: RowValidationProblem): SyncError {
  switch (problem.type) {
    case 'payload_not_object':
      return { type: 'bootstrap.response_missing_data', model: requestedModel }
    case 'unknown_model':
      return { type: 'bootstrap.unknown_model', model: problem.model }
    case 'rows_not_array':
      return { type: 'bootstrap.response_data_not_array', model: problem.model }
    case 'invalid_row':
      return { type: 'bootstrap.invalid_row', model: problem.model, issues: problem.issues }
  }
}

function messageFor(error: SyncError): string {
  switch (error.type) {
    case 'bootstrap.unknown_model':
      return `Unknown model "${error.model}"`
    case 'bootstrap.fetch_failed':
      return error.cause.message
    case 'bootstrap.http_failed':
      return `Bootstrap fetch failed: ${error.response.status} ${error.response.statusText}`
    case 'bootstrap.response_missing_data':
      return 'Bootstrap response was not an object of rows'
    case 'bootstrap.response_data_not_array':
      return 'Bootstrap response "data" was not an array'
    case 'bootstrap.invalid_row':
      return `Invalid row: ${error.issues.map(issue => issue.message).join('; ')}`
    case 'validation.invalid_json':
      return error.cause.message
    default:
      return error.type
  }
}
