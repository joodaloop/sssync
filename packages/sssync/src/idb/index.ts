import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb'

import type { ClientDatabaseSchema, IdInputOf, Relationship, RowOf, TableName, TableSchema, Tables } from '../schema'
import { primaryKeyFor, tupleKey } from '../shared'
import type { IDBReadTransaction, IDBStorage, IDBStorageInitOptions } from './types'

export type { IDBReadTransaction, IDBStorage, IDBStorageInitOptions } from './types'

type StorageRecord = {
  readonly key: string
  readonly row: Record<string, unknown>
  readonly indexes: Record<string, string>
}

type IndexPlan = {
  readonly name: string
  readonly fields: readonly string[]
}

type TablePlan = {
  readonly table: TableSchema
  readonly indexes: readonly IndexPlan[]
}

type DatabasePlan = {
  readonly tables: readonly TablePlan[]
}

const KV_STORE_NAME = 'sss_kv'

/**
 * IndexedDB-backed implementation of {@link IDBStorage}.
 *
 * Importing this module pulls the implementation into the bundle, so only
 * reference it from app code that actually enables persistence. The sssync core
 * imports only the `IDBStorage` type (from `./types`), never this class, so an
 * app running with `storage: null` never bundles it.
 */
export class IndexedDBStorage<S extends ClientDatabaseSchema = ClientDatabaseSchema> implements IDBStorage<S> {
  // `declare` satisfies the nominal brand without emitting a runtime field.
  declare readonly __idbStorage: 'IDBStorage'

  #db: Promise<IDBPDatabase> | undefined
  #plan: DatabasePlan | undefined

  init(options: IDBStorageInitOptions<S>): void {
    if (this.#db) {
      throw new Error('IndexedDBStorage has already been initialized')
    }

    const plan = planForSchema(options.schema)
    const databaseName = databaseNameFor(options)
    this.#plan = plan
    this.#db = openDB(databaseName, options.schemaVersion, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains(KV_STORE_NAME)) {
          db.createObjectStore(KV_STORE_NAME)
        }

        for (const tablePlan of plan.tables) {
          const store = db.objectStoreNames.contains(tablePlan.table.name)
            ? transaction.objectStore(tablePlan.table.name)
            : db.createObjectStore(tablePlan.table.name, { keyPath: 'key' })

          for (const index of tablePlan.indexes) {
            if (!store.indexNames.contains(index.name)) {
              store.createIndex(index.name, `indexes.${index.name}`)
            }
          }
        }
      },
    })
  }

  get ready(): Promise<IDBPDatabase> {
    if (!this.#db) {
      throw new Error('IndexedDBStorage has not been initialized')
    }
    return this.#db
  }

  async read<T>(callback: (transaction: IDBReadTransaction<S>) => Promise<T>): Promise<T> {
    const db = await this.ready
    const transaction = db.transaction(this.storeNames(), 'readonly')
    const reader = new IndexedDBReadTransaction<S>(transaction, tableName => this.tablePlanFor(tableName))
    return callback(reader)
  }

  async readKV(id: string): Promise<unknown | undefined> {
    const db = await this.ready
    return db.get(KV_STORE_NAME, id)
  }

  async writeKV(id: string, value: unknown): Promise<void> {
    const db = await this.ready
    await db.put(KV_STORE_NAME, value, id)
  }

  storeMutations(): void {
    // TODO: persist mutation queue entries.
  }

  getMutationsFromIdExclusive(): void {
    // TODO: read mutation queue entries after the given mutation id.
  }

  setRowTo(): void {
    // TODO: persist a full row state or tombstone.
  }

  private tablePlanFor(tableName: string): TablePlan {
    const tablePlan = this.#plan?.tables.find(plan => plan.table.name === tableName)
    if (!tablePlan) {
      throw new Error(`Unknown table "${tableName}"`)
    }
    return tablePlan
  }

  private storeNames(): string[] {
    const storeNames = this.#plan?.tables.map(plan => plan.table.name)
    if (!storeNames) {
      throw new Error('IndexedDBStorage has not been initialized')
    }
    return storeNames
  }
}

class IndexedDBReadTransaction<S extends ClientDatabaseSchema> implements IDBReadTransaction<S> {
  constructor(
    private readonly transaction: IDBPTransaction,
    private readonly tablePlanFor: (tableName: string) => TablePlan,
  ) {}

  async getRow<Name extends TableName<S>>(
    tableName: Name,
    id: IdInputOf<Tables<S>[Name]>,
  ): Promise<RowOf<Tables<S>[Name]> | undefined> {
    const tablePlan = this.tablePlanFor(tableName)
    const record = (await this.transaction.objectStore(tableName).get(primaryKeyFor(tablePlan.table, id))) as
      | StorageRecord
      | undefined
    return record?.row as RowOf<Tables<S>[Name]> | undefined
  }

  async getRowsByRelation<Name extends TableName<S>>(
    tableName: Name,
    fields: readonly string[],
    values: readonly unknown[],
  ): Promise<readonly RowOf<Tables<S>[Name]>[]> {
    const tablePlan = this.tablePlanFor(tableName)
    const indexName = indexNameFor(fields)
    if (!tablePlan.indexes.some(index => index.name === indexName)) {
      throw new Error(`Unknown index "${indexName}" on table "${tableName}"`)
    }

    const records = (await this.transaction
      .objectStore(tableName)
      .index(indexName)
      .getAll(tupleKey(values))) as StorageRecord[]
    return records.map(record => record.row as RowOf<Tables<S>[Name]>)
  }
}

function databaseNameFor(options: Pick<IDBStorageInitOptions, 'schema' | 'name' | 'id'>): string {
  return `sss_${options.schema.hash}_${options.name}_${options.id}`
}

function planForSchema(schema: ClientDatabaseSchema): DatabasePlan {
  const indexesByTable = new Map<string, Map<string, IndexPlan>>()

  for (const tableName of Object.keys(schema.tables)) {
    if (tableName === KV_STORE_NAME) {
      throw new Error(`Table name "${KV_STORE_NAME}" is reserved for sssync IndexedDB metadata`)
    }
    indexesByTable.set(tableName, new Map())
  }

  for (const relationships of Object.values(schema.relationships)) {
    for (const relationship of Object.values(relationships)) {
      addRelationshipIndexes(indexesByTable, relationship)
    }
  }

  return {
    tables: Object.values(schema.tables).map(table => ({
      table,
      indexes: [...(indexesByTable.get(table.name)?.values() ?? [])],
    })),
  }
}

function addRelationshipIndexes(indexesByTable: Map<string, Map<string, IndexPlan>>, relationship: Relationship): void {
  for (const connection of relationship) {
    const tableIndexes = indexesByTable.get(connection.destSchema)
    if (!tableIndexes) {
      throw new Error(`Relationship destination table "${connection.destSchema}" is missing`)
    }

    const name = indexNameFor(connection.destField)
    if (!tableIndexes.has(name)) {
      tableIndexes.set(name, {
        name,
        fields: connection.destField,
      })
    }
  }
}

function indexNameFor(fields: readonly string[]): string {
  return fields.map(field => encodeURIComponent(field)).join('__')
}
