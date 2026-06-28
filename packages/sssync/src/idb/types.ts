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
export interface IDBStorage {
  readonly __idbStorage: 'IDBStorage'
}
