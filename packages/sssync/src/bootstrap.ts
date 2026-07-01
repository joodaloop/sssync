import { fetchJSON } from './boundaries'
import type { HttpFailure, IDBReadFailure, ValidationFailure } from './errors'
import type { IDBKVTransaction, IDBStorage } from './idb/types'
import { object, string } from './json-validator'
import { listenChannel } from './listen-channel'
import type { ChannelListener } from './listen-channel'
import type { TableName } from './schema/infer'
import type { ClientDatabaseSchema } from './schema/table-schema'
import type { Observable } from './shared'
import type { Reporter, ReporterFactory } from './sss'
import type { RowsByTable } from './store'
import type { ValidatePayload } from './validate'

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
        - Attempt to persist the boostrap success
          - Notify other tabs through the `bootstrap-broadcast-channel`
  - FAILS:
    - Set `this.bootstrapStatuses[tableName]` to the corresponding Failure
*/

type BootstrapStatus = 'pending' | 'success' | HttpFailure | ValidationFailure | IDBReadFailure

export type BootstrapsSnapshot<S extends ClientDatabaseSchema> = Readonly<Partial<Record<TableName<S>, BootstrapStatus>>>

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
    const loaded: Partial<Record<string, BootstrapStatus>> = {}
    await this.storage?.transactionKVStore(async kv => {
      for (const tableName of this.tableNames) {
        loaded[tableName] = await this.readPersistedBootstrapStatus(tableName, kv)
      }
    })

    this.bootstrapStatuses.set({ ...this.bootstrapStatuses.get(), ...loaded })
  }

  private rescan = async (modelName: string): Promise<void> => {
    const status = await this.storage?.transactionKVStore(kv =>
      this.readPersistedBootstrapStatus(modelName, kv),
    )
    this.bootstrapStatuses.set({ ...this.bootstrapStatuses.get(), [modelName]: status })
  }

  private async readPersistedBootstrapStatus(
    tableName: string,
    kv: IDBKVTransaction,
  ): Promise<'success' | undefined> {
    const key = bootstrapKVKey(tableName)
    const read = await kv.get(key)
    if (!read.ok) {
      this.report({ type: read.error.type, offending: { store: key, key, error: read.error } })
      return undefined
    }
    return read.value === 'success' ? 'success' : undefined
  }



  async load(modelName: string) {
    const url = `${this.bootstrapURL}?model=${encodeURIComponent(modelName)}`
    const payload = await fetchJSON(url)
    if (!payload.ok) return payload
    return this.validatePayload(payload.value)
  }

}
