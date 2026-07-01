import { fetchJSON } from './boundaries'
import type { Failure } from './errors'
import type { IDBStorage } from './idb/types'
import { enums, object, optional, safeValidate, string } from './json-validator'
import { listenChannel } from './listen-channel'
import type { ChannelListener } from './listen-channel'
import { attemptAsync } from './result'
import type { Result } from './result'
import type { TableName } from './schema/infer'
import type { ClientDatabaseSchema } from './schema/table-schema'
import type { LoadingStatus, Observable } from './shared'
import type { Reporter, ReporterFactory } from './sss'
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

// Cross-tab notification that a model's persisted bootstrap state changed.
// `id` is the model/table name.
const bootstrapMessageSchema = object({ id: string() })

export const BOOTSTRAPS_KV_PREFIX = 'bootstraps'

export function bootstrapKVKey(tableName: string): string {
  return `${BOOTSTRAPS_KV_PREFIX}:${tableName}`
}

const bootstrapStateSchema = object({
  status: enums(['pending', 'success', 'error']),
  error: optional(string()),
})

export function isBootstrapState(value: unknown): value is BootstrapState {
  return safeValidate(bootstrapStateSchema, value).ok
}

export class Bootstrap<S extends ClientDatabaseSchema> {
  // In-flight loads keyed by model. Recorded synchronously in `load` so
  // concurrent calls share one fetch before consulting the bootstrap registry.
  private readonly inflight = new Map<string, LoadResult>()
  private readonly report: Reporter
  // Cross-tab channel; null in environments without BroadcastChannel (e.g. the
  // server) so bootstrap still works there.
  private readonly channel: ChannelListener<typeof bootstrapMessageSchema> | null

  constructor(
    private readonly bootstrapURL: string,
    private readonly bootstraps: Observable<BootstrapsSnapshot<S>>,
    private readonly validatePayload: ValidatePayload<S>,
    private readonly addIfNotExist: (rowsByTable: RowsByTable<S>) => void,
    reporterFor: ReporterFactory,
    sssyncId: string,
    private readonly storage: IDBStorage<S> | null,
    private readonly tableNames: readonly string[],
  ) {
    this.report = reporterFor('bootstrap')
    this.channel = typeof BroadcastChannel === 'undefined'
      ? null
      : listenChannel(sssyncId, 'bootstrap', bootstrapMessageSchema)
    // Another tab persisted a status change (e.g. marked a model succeeded);
    // rescan the persisted state so this tab's observable catches up.
    this.channel?.handle(message => void this.rescan(message.id))
  }

  close(): void {
    this.channel?.close()
  }

  // Loads every model's persisted bootstrap state into the observable. Call
  // once before serving loads so already-bootstrapped models are recognised.
  async hydrate(): Promise<void> {
    if (!this.storage) return

    const snapshot: Record<string, BootstrapState> = {}
    const result = await attemptAsync(
      () =>
        this.storage!.transactionKVStore(async kv => {
          for (const tableName of this.tableNames) {
            const key = bootstrapKVKey(tableName)
            const read = await attemptAsync(() => kv.get(key), error => error)
            if (!read.ok) {
              this.report({ type: 'persistence', offending: { store: key, key, error: read.error } })
            }
            const value = read.ok ? read.value : undefined
            if (isBootstrapState(value)) snapshot[tableName] = value
          }
        }),
      error => error,
    )

    if (!result.ok) {
      this.report({ type: 'persistence', offending: { store: BOOTSTRAPS_KV_PREFIX, error: result.error } })
      return
    }
    if (Object.keys(snapshot).length > 0) {
      this.bootstraps.set(snapshot as BootstrapsSnapshot<S>)
    }
  }

  // Re-reads a model's persisted bootstrap state and applies it locally. Does
  // not persist or broadcast: this only reflects a change another tab made.
  private rescan = async (modelName: string): Promise<void> => {
    const state = await this.readPersistedState(modelName)
    if (state) this.setState(modelName, state)
  }

  private async readPersistedState(modelName: string): Promise<BootstrapState | undefined> {
    if (!this.storage) return undefined

    const key = bootstrapKVKey(modelName)
    const result = await attemptAsync(
      () => this.storage!.transactionKVStore(kv => kv.get(key)),
      error => error,
    )
    if (!result.ok) {
      this.report({ type: 'persistence', offending: { store: key, key, error: result.error } })
      return undefined
    }
    return isBootstrapState(result.value) ? result.value : undefined
  }

  private async persist(name: string, state: BootstrapState): Promise<void> {
    if (!this.storage) return

    const key = bootstrapKVKey(name)
    const result = await attemptAsync(
      () => this.storage!.transactionKVStore(kv => kv.put(key, state)),
      error => error,
    )
    if (!result.ok) {
      this.report({ type: 'persistence', offending: { store: key, key, error: result.error } })
    }
  }

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
    if (!result.ok) return this.fail(modelName, result.error)

    this.addIfNotExist(result.value)
    this.changeStatus({ name: modelName, status: 'success' })
    return result.value[modelName as TableName<S>] ?? []
  }

  private async fetchRows(modelName: string): Promise<Result<RowsByTable<S>, Failure>> {
    const url = `${this.bootstrapURL}?model=${encodeURIComponent(modelName)}`
    const payload = await fetchJSON(url)
    if (!payload.ok) return payload
    return this.validatePayload(payload.value)
  }

  private fail(modelName: string, error: Failure): undefined {
    this.report(error)
    this.changeStatus({ name: modelName, status: 'error', error: error.type })
    return undefined
  }

  private changeStatus(change: StatusChange): void {
    const state: BootstrapState = {
      status: change.status,
      ...(change.error === undefined ? {} : { error: change.error }),
    }
    this.setState(change.name, state)
    // Persist, then tell other tabs so they can rescan the new state.
    void this.persist(change.name, state).then(() => this.channel?.post({ id: change.name }))
  }

  private setState(name: string, state: BootstrapState): void {
    this.bootstraps.set({
      ...this.bootstraps.get(),
      [name]: state,
    })
  }
}
