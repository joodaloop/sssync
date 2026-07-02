import type { Failure } from '../../src/errors'
import type { IDBKVTransaction, IDBStorage } from '../../src/idb/types'
import { rowValidatorsFor, validateRowsByTable } from '../../src/boundaries'
import { err, ok } from '../../src/result'
import { column, createSchema, table } from '../../src/schema'
import type { ReporterFactory, Where } from '../../src/sss'

// listenChannel treats the absence of `window` as "running on the server" and
// no-ops. Bun's test runtime has no `window`, so define one to exercise the
// real (browser) BroadcastChannel path.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  ;(globalThis as { window?: unknown }).window = globalThis
}

// The shared test schema. Keep this in sync with what the test suite exercises;
// new tests should import from here rather than redefining a local `issues`.
export const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    priority: column.number(),
    done: column.boolean(),
    ownerId: column.string().optional(),
  })
  .primaryKey('id')

export const schema = createSchema({ tables: [issues] })
export type Schema = typeof schema

const validators = rowValidatorsFor(schema)
export const validatePayload = (payload: unknown) => validateRowsByTable<Schema>(payload, validators)

export const validRow = {
  id: '1',
  title: 'First',
  priority: 1,
  done: false,
  ownerId: null,
}

// An in-memory `IDBStorage` for exercising persistence paths. `values` exposes
// the backing store, `puts` records every successful write, and `options` lets
// a test force read/write failures.
export function fakeStorage(
  initial: readonly [string, unknown][] = [],
  options: { readonly failGet?: boolean; readonly failPut?: boolean } = {},
) {
  const values = new Map<string, unknown>(initial)
  const puts: [string, unknown][] = []
  const kv: IDBKVTransaction = {
    async get(id) {
      if (options.failGet) {
        return err({ type: 'idb_read', offending: { store: id, key: id, error: new Error('kv get failed') } })
      }
      return ok(values.get(id))
    },
    async put(id, value) {
      if (options.failPut) {
        return err({ type: 'idb_write', offending: { store: id, key: id, error: new Error('kv put failed') } })
      }
      puts.push([id, value])
      values.set(id, value)
      return ok(value)
    },
  }
  const storage: IDBStorage<Schema> = {
    __idbStorage: 'IDBStorage',
    init() {},
    async read() {
      throw new Error('read is not implemented for this test storage')
    },
    async transactionKVStore(callback) {
      return callback(kv)
    },
  }
  return { storage, values, puts }
}

export type Reported = Failure & { where: Where }

// Collects everything reported through the ReporterFactory, tagged with `where`.
export const recordErrors = () => {
  const errors: Reported[] = []
  const reporterFor: ReporterFactory = where => failure => {
    errors.push({ ...failure, where })
  }
  return { errors, reporterFor }
}

// Yields a macrotask so fire-and-forget persistence work settles.
export const settleAsyncWork = () => new Promise(resolve => setTimeout(resolve, 0))
