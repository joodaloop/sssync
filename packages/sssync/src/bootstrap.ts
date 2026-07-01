import { fetchJSON } from './boundaries'
import type { ValidatePayload } from './boundaries'
import type { Failure } from './errors'
import type { IDBKVTransaction, IDBStorage } from './idb/types'
import { object, string } from './json-validator'
import { listenChannel } from './listen-channel'
import type { ChannelListener } from './listen-channel'
import type { TableName, ClientDatabaseSchema } from './schema'
import type { Observable } from './shared'
import type { Reporter, ReporterFactory } from './sss'
import type { RowsByTable } from './store'

type BootstrapStatus = 'pending' | 'success' | Failure

export type BootstrapsSnapshot<S extends ClientDatabaseSchema> = Readonly<
  Partial<Record<TableName<S>, BootstrapStatus>>
>

const bootstrapMessageSchema = object({ id: string() })
export const BOOTSTRAPS_KV_PREFIX = 'bootstraps'

export function bootstrapKVKey(tableName: string): string {
  return `${BOOTSTRAPS_KV_PREFIX}:${tableName}`
}

/**
 * Tracks and drives per-table bootstrapping. Table statuses live in the
 * `bootstrapStatuses` observable ('pending' | 'success' | Failure, or undefined).
 *
 * Successes are persisted to the KV store and broadcast across tabs. Failures are recorded but not persisted, and can be retried.
 */
export class Bootstrap<S extends ClientDatabaseSchema> {
  private readonly report: Reporter
  private readonly channel: ChannelListener<typeof bootstrapMessageSchema>

  /** Subscribes to the cross-tab channel; each message triggers a `rescan`. */
  constructor(
    private readonly bootstrapURL: string,
    private readonly bootstrapStatuses: Observable<BootstrapsSnapshot<S>>,
    private readonly validatePayload: ValidatePayload<S>,
    private readonly addToStoreIfNotExist: (rowsByTable: RowsByTable<S>) => void,
    reporterFor: ReporterFactory,
    sssyncId: string,
    private readonly storage: IDBStorage<S> | null,
    private readonly tableNames: readonly string[],
  ) {
    this.report = reporterFor('bootstrap')
    this.channel = listenChannel(sssyncId, 'bootstrap', bootstrapMessageSchema)
    this.channel.handle(message => void this.rescan(message.id))
  }

  /** Tears down the cross-tab channel subscription. */
  close(): void {
    this.channel.close()
  }

  /** Loads persisted 'success' statuses for every known table into the observable. */
  async hydrate(): Promise<void> {
    if (!this.storage) return

    const loaded: Partial<Record<string, BootstrapStatus>> = {}
    await this.storage.transactionKVStore(async kv => {
      for (const tableName of this.tableNames) {
        loaded[tableName] = await this.readPersistedBootstrapStatus(tableName, kv)
      }
    })

    this.bootstrapStatuses.set({ ...this.bootstrapStatuses.get(), ...loaded })
  }

  /**
   * Bootstraps a single table, driving it through its status transitions.
   *
   * If `bootstrapStatuses[modelName]` is already 'success' or 'pending', returns
   * immediately — the table is done or in flight. (A Failure status falls
   * through, so a previously failed table retries here.) Otherwise:
   *
   *   1. Set the status to 'pending'.
   *   2. Fetch `bootstrapURL?model=<modelName>` and validate the payload.
   *      - If the fetch fails:
   *          - Set the status to the http Failure and stop.
   *      - If validation fails:
   *          - Set the status to the validation Failure and stop.
   *      - If both succeed:
   *          - Hand the rows to `addToStoreIfNotExist`.
   *          - Set the status to 'success'.
   *          - Persist the success and broadcast it to other tabs
   *            (best-effort; see `persistSuccess`).
   */
  async load(modelName: string): Promise<void> {
    const current = this.bootstrapStatuses.get()[modelName as TableName<S>]
    if (current === 'success' || current === 'pending') return undefined

    this.setStatus(modelName, 'pending')

    const url = `${this.bootstrapURL}?model=${encodeURIComponent(modelName)}`
    const payload = await fetchJSON(url)
    if (!payload.ok) {
      this.setStatus(modelName, payload.error)
      return undefined
    }

    const validated = this.validatePayload(payload.value)
    if (!validated.ok) {
      this.setStatus(modelName, validated.error)
      return undefined
    }

    this.addToStoreIfNotExist(validated.value)
    this.setStatus(modelName, 'success')
    await this.persistSuccess(modelName)
  }

  // Best-effort persistence of a bootstrap success, then notify other tabs so
  // they can rescan and pick up the persisted status without re-fetching.
  private async persistSuccess(modelName: string): Promise<void> {
    if (!this.storage) return

    const key = bootstrapKVKey(modelName)
    const write = await this.storage.transactionKVStore(kv => kv.put(key, 'success'))
    if (!write.ok) {
      this.report({ type: write.error.type, offending: write.error.offending })
      return
    }
    this.channel.post({ id: modelName })
  }

  private rescan = async (modelName: string): Promise<void> => {
    if (!this.storage) return

    const status = await this.storage.transactionKVStore(kv => this.readPersistedBootstrapStatus(modelName, kv))
    this.setStatus(modelName, status)
  }

  private async readPersistedBootstrapStatus(tableName: string, kv: IDBKVTransaction): Promise<'success' | undefined> {
    const key = bootstrapKVKey(tableName)
    const read = await kv.get(key)
    if (!read.ok) {
      this.report({ type: read.error.type, offending: { store: key, key, error: read.error } })
      return undefined
    }
    return read.value === 'success' ? 'success' : undefined
  }

  private setStatus(modelName: string, status: BootstrapStatus | undefined): void {
    this.bootstrapStatuses.set({ ...this.bootstrapStatuses.get(), [modelName]: status })
  }
}
