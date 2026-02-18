import { type IDBPDatabase, type IDBPTransaction, openDB } from 'idb'

export type IndexedDbConfig = {
  name: string
  version: number
  eventStoreName: string
  cacheStoreName: string
}

export type IndexedDbClient = {
  open(): Promise<IDBPDatabase<unknown>>
  close(): Promise<void>
  clear(): Promise<void>
  getAll<Value>(storeName: string): Promise<Value[]>
  scanByPrefix<Value>(storeName: string, prefix: string): Promise<Value[]>
  withReadwrite<Value>(
    storeNames: string[],
    run: (transaction: IDBPTransaction<unknown, string[], 'readwrite'>) => Promise<Value>
  ): Promise<Value>
}

export const createIndexedDbClient = (config: IndexedDbConfig): IndexedDbClient => {
  let databasePromise: Promise<IDBPDatabase<unknown>> | null = null
  const open = () => {
    if (!databasePromise) {
      databasePromise = openDB(config.name, config.version, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(config.eventStoreName)) {
            database.createObjectStore(config.eventStoreName, { keyPath: 'id' })
          }
          if (!database.objectStoreNames.contains(config.cacheStoreName)) {
            database.createObjectStore(config.cacheStoreName, { keyPath: 'key' })
          }
        }
      })
    }
    return databasePromise
  }

  const close = async () => {
    if (!databasePromise) {
      return
    }
    const database = await databasePromise
    database.close()
    databasePromise = null
  }

  const clear = async () => {
    const database = await open()
    const transaction = database.transaction(
      [config.eventStoreName, config.cacheStoreName],
      'readwrite'
    )
    await Promise.all([
      transaction.objectStore(config.eventStoreName).clear(),
      transaction.objectStore(config.cacheStoreName).clear()
    ])
    await transaction.done
  }

  const getAll = async <Value>(storeName: string): Promise<Value[]> => {
    const database = await open()
    return database.getAll(storeName)
  }

  const scanByPrefix = async <Value>(storeName: string, prefix: string): Promise<Value[]> => {
    const database = await open()
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`)
    return database.getAll(storeName, range)
  }

  const withReadwrite = async <Value>(
    storeNames: string[],
    run: (transaction: IDBPTransaction<unknown, string[], 'readwrite'>) => Promise<Value>
  ): Promise<Value> => {
    const database = await open()
    const transaction = database.transaction(storeNames, 'readwrite')
    const result = await run(transaction)
    await transaction.done
    return result
  }

  return { open, close, clear, getAll, scanByPrefix, withReadwrite }
}
