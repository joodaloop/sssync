import type { ClientDatabaseSchema, IdInputOf, RowOf, TableName, Tables } from '../schema'
import type { ValidatePayload } from '../validate'

export type IDBStorageInitOptions<S extends ClientDatabaseSchema = ClientDatabaseSchema> = {
  readonly name: string
  readonly id: string
  readonly schema: S
  readonly schemaVersion: number
  // Same validator the sync core feeds to its network paths, reused here so
  // persisted rows are validated against their write schema on read.
  readonly validatePayload: ValidatePayload<S>
}

export interface IDBReadTransaction<S extends ClientDatabaseSchema = ClientDatabaseSchema> {
  getRow<Name extends TableName<S>>(
    tableName: Name,
    id: IdInputOf<Tables<S>[Name]>,
  ): Promise<RowOf<Tables<S>[Name]> | undefined>
  getRowsByRelation<Name extends TableName<S>>(
    tableName: Name,
    fields: readonly string[],
    values: readonly unknown[],
  ): Promise<readonly RowOf<Tables<S>[Name]>[]>
}

export interface IDBKVTransaction {
  get(id: string): Promise<unknown | undefined>
  put(id: string, value: unknown): Promise<void>
}

/**
 * Storage contract for sssync persistence.
 *
 * This module is **pure types** — it emits no runtime code, so importing it
 * (even accidentally as a value) pulls nothing into the bundle. The core
 * depends only on this type; concrete implementations live in sibling modules
 * (e.g. {@link IndexedDBStorage} in `./index`), so an implementation is bundled
 * only when an app imports and constructs it.
 *
 * Stub for now — the real read/write/transaction surface goes here. The brand
 * keeps it nominal so arbitrary objects don't satisfy `null | IDBStorage`.
 */
export interface IDBStorage<S extends ClientDatabaseSchema = ClientDatabaseSchema> {
  readonly __idbStorage: 'IDBStorage'
  init(options: IDBStorageInitOptions<S>): void
  read<T>(callback: (transaction: IDBReadTransaction<S>) => Promise<T>): Promise<T>
  transactionKVStore<T>(callback: (transaction: IDBKVTransaction) => Promise<T>): Promise<T>
}
