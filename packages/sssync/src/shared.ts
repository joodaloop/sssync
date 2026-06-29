import type { TableSchema } from './schema/table-schema'

export function mapValues<T extends Record<string, unknown>, U>(
  input: T,
  mapper: (value: T[keyof T]) => U,
): { [K in keyof T]: U } {
  return mapEntries(input, (k, v) => [k, mapper(v as T[keyof T])]) as {
    [K in keyof T]: U
  }
}

export function mapEntries<T, U>(
  input: Record<string, T>,
  mapper: (key: string, val: T) => [key: string, val: U],
): Record<string, U> {
  const output: Record<string, U> = {}
  for (const entry of Object.entries(input)) {
    const mapped = mapper(entry[0], entry[1])
    output[mapped[0]] = mapped[1]
  }
  return output
}

export function mapAllEntries<T, U>(
  input: Record<string, T>,
  mapper: (entries: [key: string, val: T][]) => [key: string, val: U][],
): Record<string, U> {
  const output: Record<string, U> = {}
  for (const mapped of mapper(Object.entries(input))) {
    output[mapped[0]] = mapped[1]
  }
  return output
}

export function hasOwn(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

export type Listener = () => void

// The read side of an Observable: a referentially-stable snapshot plus a way to
// be notified when it changes. This is the external-store contract, so framework
// wrappers can bind to it — Solid via `from`, React via `useSyncExternalStore` —
// without the core depending on any UI framework.
export interface ReadonlyObservable<T> {
  get(): T
  subscribe(listener: Listener): () => void
}

// A minimal observable value. Holds one snapshot whose identity is stable until
// `set` is called, and notifies listeners on each `set`. Callers are responsible
// for passing a new reference when the value has actually changed.
export class Observable<T> implements ReadonlyObservable<T> {
  #value: T
  readonly #listeners = new Set<Listener>()

  constructor(initial: T) {
    this.#value = initial
  }

  get(): T {
    return this.#value
  }

  set(value: T): void {
    this.#value = value
    for (const listener of this.#listeners) listener()
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
}

export type ResolvedItem = {
  readonly modelName: string
  readonly id: unknown
  readonly relation?: string
  readonly key: string
}

export function tupleKey(parts: readonly unknown[]): string {
  return JSON.stringify(parts)
}

export function primaryKeyValues(
  table: TableSchema,
  idOrRow: unknown,
): readonly unknown[] {
  if (table.primaryKey.length === 1) {
    const key = table.primaryKey[0]
    if (idOrRow !== null && typeof idOrRow === 'object' && key in idOrRow) {
      return [(idOrRow as Record<string, unknown>)[key]]
    }
    return [idOrRow]
  }

  if (idOrRow === null || typeof idOrRow !== 'object' || Array.isArray(idOrRow)) {
    throw new Error(
      `Composite primary key for table "${table.name}" requires an object`,
    )
  }

  const record = idOrRow as Record<string, unknown>
  for (const key of table.primaryKey) {
    if (!(key in record)) {
      throw new Error(
        `Composite primary key for table "${table.name}" is missing "${key}"`,
      )
    }
  }
  return table.primaryKey.map(key => record[key])
}

export function primaryKeyFor(table: TableSchema, idOrRow: unknown): string {
  return tupleKey(primaryKeyValues(table, idOrRow))
}

export function resolvedItemFor(
  table: TableSchema,
  item: {
    readonly modelName: string
    readonly id: unknown
    readonly relation?: string
  },
): ResolvedItem {
  return {
    ...item,
    key: primaryKeyFor(table, item.id),
  }
}

export function cacheKeyForItem(item: ResolvedItem) {
  return tupleKey([item.modelName, item.key, item.relation ?? null])
}

export function rowKeyForItem(item: ResolvedItem) {
  return tupleKey([item.modelName, item.key])
}

export function coveredKeysForItem(item: ResolvedItem): readonly string[] {
  const ownKey = cacheKeyForItem(item)
  if (!item.relation) {
    return [ownKey]
  }

  return [
    cacheKeyForItem({
      modelName: item.modelName,
      id: item.id,
      key: item.key,
    }),
    ownKey,
  ]
}

/** The values that can be represented in JSON */
export type JSONValue =
  | null
  | string
  | boolean
  | number
  | Array<JSONValue>
  | JSONObject

/**
 * A JSON object. This is a map from strings to JSON values or `undefined`. We
 * allow `undefined` values as a convenience... but beware that the `undefined`
 * values do not round trip through JSON serialization.
 */
export type JSONObject = { [key: string]: JSONValue | undefined }

/** Like {@link JSONValue} but deeply readonly */
export type ReadonlyJSONValue =
  | null
  | string
  | boolean
  | number
  | ReadonlyArray<ReadonlyJSONValue>
  | ReadonlyJSONObject

/** Like {@link JSONObject} but deeply readonly */
export type ReadonlyJSONObject = {
  readonly [key: string]: ReadonlyJSONValue | undefined
}
