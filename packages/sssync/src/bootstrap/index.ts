import { rowSchemaFor } from '../schema/row-schema'
import type { TableName } from '../schema/infer'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import type { Observable } from '../shared'
import { safeValidate } from '../json-validator'

export type BootstrapStatus = 'pending' | 'success' | 'error'

// Per-model bootstrap state.
export type BootstrapState = {
  readonly status: BootstrapStatus
  readonly error?: string
}

// Bootstrap state keyed by model name.
export type BootstrapsSnapshot<S extends ClientDatabaseSchema> = Readonly<
  Partial<Record<TableName<S>, BootstrapState>>
>

export type StatusChange<Name extends string = string> = {
  readonly name: Name
} & BootstrapState

type LoadResult = Promise<readonly unknown[] | undefined>

export class Bootstrap<S extends ClientDatabaseSchema> {
  // One row validator per table, derived from the schema's write columns.
  private readonly rowValidators: Record<string, ReturnType<typeof rowSchemaFor>>
  // In-flight loads keyed by model. Recorded synchronously in `load` so
  // concurrent calls share one fetch before consulting the bootstrap registry.
  private readonly inflight = new Map<string, LoadResult>()

  constructor(
    private readonly schema: S,
    private readonly bootstrapURL: string,
    private readonly bootstraps: Observable<BootstrapsSnapshot<S>>,
  ) {
    this.rowValidators = Object.fromEntries(
      Object.entries(schema.tables).map(([name, table]) => [
        name,
        rowSchemaFor(table),
      ]),
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

    if (!this.rowValidators[modelName]) {
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
    const validator = this.rowValidators[modelName]

    // Skip if already bootstrapped ('success') or being bootstrapped by another
    // session/tab ('pending'); the in-flight map handles same-instance dedupe.
    const existing = this.bootstraps.get()[modelName as TableName<S>]?.status
    if (existing === 'success' || existing === 'pending') return undefined

    this.changeStatus({ name: modelName, status: 'pending' })

    try {
      const url = `${this.bootstrapURL}?model=${encodeURIComponent(modelName)}`
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Bootstrap fetch failed: ${res.status} ${res.statusText}`)
      }

      const rows = validateData(await res.json(), validator)
      this.changeStatus({ name: modelName, status: 'success' })
      return rows
    } catch (error) {
      this.changeStatus({
        name: modelName,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
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
// matches `validator`. Throws otherwise so `load` can report the error message.
function validateData(
  payload: unknown,
  validator: ReturnType<typeof rowSchemaFor>,
): readonly unknown[] {
  if (payload === null || typeof payload !== 'object' || !('data' in payload)) {
    throw new Error('Bootstrap response had no "data" array')
  }

  const { data } = payload as { data: unknown }
  if (!Array.isArray(data)) {
    throw new Error('Bootstrap response "data" was not an array')
  }

  for (const row of data) {
    const result = safeValidate(validator, row)
    if (!result.success) {
      const message = result.issues.map(issue => issue.message).join('; ')
      throw new Error(`Invalid row: ${message}`)
    }
  }

  return data
}
