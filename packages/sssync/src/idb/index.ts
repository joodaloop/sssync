import type { IDBStorage } from './types'

export type { IDBStorage } from './types'

/**
 * IndexedDB-backed implementation of {@link IDBStorage}. Stub for now.
 *
 * Importing this module pulls the implementation into the bundle, so only
 * reference it from app code that actually enables persistence. The sssync core
 * imports only the `IDBStorage` type (from `./types`), never this class, so an
 * app running with `storage: null` never bundles it.
 */
export class IndexedDBStorage implements IDBStorage {
  // `declare` satisfies the nominal brand without emitting a runtime field.
  declare readonly __idbStorage: 'IDBStorage'
}
