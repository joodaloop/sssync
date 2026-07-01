import { Result } from 'better-result'

import { fetchJSON } from './better'
import type { Report, Reported } from './better'
import type { TableName } from './schema/infer'
import type { ClientDatabaseSchema } from './schema/table-schema'
import type { LoadingStatus, Observable } from './shared'
import type { RowsByTable } from './store'
import type { ValidatePayload } from './validate'

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

export class Bootstrap<S extends ClientDatabaseSchema> {
  // In-flight loads keyed by model. Recorded synchronously in `load` so
  // concurrent calls share one fetch before consulting the bootstrap registry.
  private readonly inflight = new Map<string, LoadResult>()

  constructor(
    private readonly bootstrapURL: string,
    private readonly bootstraps: Observable<BootstrapsSnapshot<S>>,
    private readonly validatePayload: ValidatePayload<S>,
    private readonly addIfNotExist: (rowsByTable: RowsByTable<S>) => void,
    private readonly report: (error: Reported) => void,
  ) {}

  // Fetches every row for `modelName` via `GET /bootstrap?model=<name>`.
  // Concurrent loads for the same model share one
  // in-flight request and resolve to the same rows. Returns undefined for an
  // unknown model or one already satisfied per the bootstrap registry.
  //
  // Synchronous on purpose: the in-flight lookup happens before any await, so
  // two back-to-back calls can't both get past it.
  load = (modelName: string): LoadResult => {
    const existing = this.inflight.get(modelName)
    if (existing) return existing

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

  private async fetchRows(modelName: string): Promise<Result<RowsByTable<S>, Report>> {
    const url = `${this.bootstrapURL}?model=${encodeURIComponent(modelName)}`
    const payload = await fetchJSON(url)
    if (Result.isError(payload)) return Result.err(payload.error)
    return this.validatePayload(payload.value)
  }

  private fail(modelName: string, error: Report): undefined {
    this.report({ ...error, where: 'bootstrap' })
    this.changeStatus({ name: modelName, status: 'error', error: error.type })
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
