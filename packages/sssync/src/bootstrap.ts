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

/*
`this.bootstrapStatuses` is an Observable to track bootstrapping status (BootstrapStatus) across tables
`this.load(tableName)` is the method to trigger a bootstrap for a particular table

 On initialisation:
  - Load successes for all `tableNames` from IDBStorage's KVStore and write to `this.bootstrapStatuses`
  - Set up listener on `bootstrap-broadcast-channel` to trigger rescans of bootstrap successes

 When .load(tableName) is called, and this.bootstrapStatuses[tableName] is not 'success' or 'pending', make a fetch request to BootstrapURL?model=tableName and set `this.bootstrapStatuses[tableName]` to "pending"
 If the fetch and validation:
  - SUCCEEDS:
    - Call .addToStoreIfNotExist()
        - Set `this.bootstrapStatuses[tableName]` to "success"
        - Persist the boostrap success
          - Notify other tabs through the `bootstrap-broadcast-channel`
  - FAILS:
    - Set `this.bootstrapStatuses[tableName]` to the corresponding Failure
*/

type BootstrapStatus = 'pending' | 'success' | Failure

export type BootstrapsSnapshot<S extends ClientDatabaseSchema> = Readonly<
  Partial<Record<TableName<S>, BootstrapStatus>>
>

const bootstrapMessageSchema = object({ id: string() })
export const BOOTSTRAPS_KV_PREFIX = 'bootstraps'

export function bootstrapKVKey(tableName: string): string {
  return `${BOOTSTRAPS_KV_PREFIX}:${tableName}`
}

export class Bootstrap<S extends ClientDatabaseSchema> {
  private readonly report: Reporter
  private readonly channel: ChannelListener<typeof bootstrapMessageSchema>

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

  close(): void {
    this.channel.close()
  }

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
}
