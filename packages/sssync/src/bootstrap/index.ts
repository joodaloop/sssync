import * as v from 'valibot'

import { rowSchemaFor } from '../schema/row-schema'
import type { ClientDatabaseSchema } from '../schema/table-schema'

export type BootstrapStatus = 'pending' | 'success' | 'error'

export type StatusChange = {
  readonly name: string
  readonly status: BootstrapStatus
  readonly error?: string
}

export class Bootstrap {
  // One row validator per table, derived from the schema's write columns.
  private readonly rowValidators: Record<string, ReturnType<typeof rowSchemaFor>>

  constructor(
    private readonly schema: ClientDatabaseSchema,
    private readonly bootstrapURL: string,
    // Returns a model's current bootstrap status from the registry, or
    // undefined if it has never been bootstrapped.
    private readonly checkStatus: (
      modelName: string,
    ) => Promise<BootstrapStatus | undefined>,
    private readonly changeStatus: (change: StatusChange) => void,
  ) {
    this.rowValidators = Object.fromEntries(
      Object.entries(schema.tables).map(([name, table]) => [
        name,
        rowSchemaFor(table),
      ]),
    )
  }

  // Fetches every row for `modelName` via `GET /bootstrap?model=<name>`,
  // expecting `{ data: rows[] }`. Skips models already satisfied or in flight
  // per `checkStatus`. Marks the model 'pending' while in flight, then
  // 'success' only once all rows validate against the write schema, or 'error'
  // (with a message) on any failure.
  load = async (modelName: string): Promise<readonly unknown[] | undefined> => {
    const validator = this.rowValidators[modelName]
    if (!validator) {
      this.changeStatus({
        name: modelName,
        status: 'error',
        error: `Unknown model "${modelName}"`,
      })
      return undefined
    }

    // Skip if already bootstrapped ('success') or in flight ('pending'); the
    // 'pending' mark below makes a concurrent load see this one and bail.
    const existing = await this.checkStatus(modelName)
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
    const result = v.safeParse(validator, row)
    if (!result.success) {
      const message = result.issues.map(issue => issue.message).join('; ')
      throw new Error(`Invalid row: ${message}`)
    }
  }

  return data
}
