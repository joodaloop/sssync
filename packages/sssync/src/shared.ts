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

export type ResolvedItem = {
  readonly modelName: string
  readonly id: string
  readonly relation?: string
}

export function cacheKeyForItem(item: ResolvedItem) {
  return item.relation
    ? `${item.modelName}***${item.id}***${item.relation}`
    : `${item.modelName}***${item.id}`
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
