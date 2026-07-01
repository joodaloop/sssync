import { Result, panic } from 'better-result'

import { describe } from './errors'
import type { Failure } from './errors'
import { attempt } from './result'
import { Bootstrap } from './bootstrap'
import type { BootstrapState, BootstrapsSnapshot } from './bootstrap'
import { CoverageTracker } from './coverage'
import type { IDBStorage } from './idb/types'
import { enums, object, optional, safeValidate, string } from './json-validator'
import type { AnyMutatorDefinition, MutationEnvelope, Mutators } from './mutators'
import { store } from './query'
import type {
  AllQueryPlan,
  OneQueryPlan,
  Query,
  QueryDetails,
  QueryStore,
  RelationName,
  RowWithIncludes,
} from './query'
import type { IdInputOf, RowOf, TableName, Tables } from './schema'
import type { ClientDatabaseSchema } from './schema/table-schema'
import { Observable } from './shared'
import type { BatchStats, ReadonlyObservable } from './shared'
import { Store } from './store'
import { rowValidatorsFor, validateRowsByTable } from './validate'

const BOOTSTRAPS_KV_PREFIX = 'bootstraps'

/** Which subsystem a failure came from; attached at the reporting boundary. */
export type Where = 'batcher' | 'bootstrap' | 'coverage' | 'sssync'

/** A subsystem-facing sink: hand it a plain Failure, it gets tagged and forwarded. */
export type Reporter = (failure: Failure) => void

/**
 * Mints a Reporter bound to a given Where. SSSync owns the real sink and hands
 * this factory down; each subsystem calls it for its own `where` and passes it
 * along to anything it builds.
 */
export type ReporterFactory = (where: Where) => Reporter

/** Arguments for a single-row query: the row id plus relations to include. */
export type OneArgs<
  S extends ClientDatabaseSchema,
  Name extends TableName<S>,
  Relations extends readonly RelationName<S, Name>[] = readonly [],
> = {
  readonly id: IdInputOf<Tables<S>[Name]>
  readonly relations?: Relations | undefined
}

export type SSSyncOptions<
  S extends ClientDatabaseSchema,
  Definitions extends { [K in keyof Definitions]: AnyMutatorDefinition<S> },
> = {
  readonly name: string
  readonly id: string
  readonly schema: S
  readonly mutators: Mutators<S, Definitions>
  readonly schemaVersion: number
  readonly batchURL: string
  readonly bootstrapURL: string
  readonly storage: null | IDBStorage<S>
}

/**
 * The entry point of a sssync app. Holds the schema and mutators together and
 * builds query plans against them.
 *
 * ```ts
 * const sync = new SSSync({ name: 'my-app', id: 'current-user', schema, mutators })
 * sync.all('issues')                                    // whole table
 * sync.one('issues', { id: 'issue-1' })                 // one row
 * sync.one('issues', { id: 'issue-1', relations: ['comments'] })
 * ```
 */
export class SSSync<
  S extends ClientDatabaseSchema,
  Definitions extends {
    [K in keyof Definitions]: AnyMutatorDefinition<S>
  } = {},
> {
  readonly ready: Promise<void>
  readonly schema: S
  readonly mutators: Mutators<S, Definitions>
  readonly stats: {
    readonly isPersistent: ReadonlyObservable<boolean>
    readonly bootstraps: ReadonlyObservable<BootstrapsSnapshot<S>>
    readonly batches: ReadonlyObservable<BatchStats>
    readonly mutationQueue: ReadonlyObservable<readonly MutationEnvelope<Mutators<S, Definitions>>[]>
    readonly queries: ReadonlyObservable<Readonly<Record<string, QueryDetails>>>
    readonly errors: ReadonlyObservable<readonly (Failure & { where: Where })[]>
  }
  readonly #store: QueryStore<S>
  readonly #rows: Store<S>
  readonly #coverage: CoverageTracker<S>
  readonly #bootstrap: Promise<Bootstrap<S>>
  readonly #storage: null | IDBStorage<S>
  readonly #isPersistent = new Observable(false)
  readonly #bootstraps = new Observable<BootstrapsSnapshot<S>>({})
  readonly #batches = new Observable<BatchStats>({ pending: [], inflight: [] })
  readonly #mutationQueue = new Observable<readonly MutationEnvelope<Mutators<S, Definitions>>[]>([])
  readonly #queries = new Observable<Readonly<Record<string, QueryDetails>>>({})
  readonly #errors = new Observable<readonly (Failure & { where: Where })[]>([])
  readonly #maxErrors = 100

  constructor(options: SSSyncOptions<S, Definitions>) {
    this.schema = options.schema
    this.mutators = options.mutators
    const v = rowValidatorsFor(options.schema)
    const validatePayload = (payload: unknown) => validateRowsByTable<S>(payload, v)
    this.#storage = options.storage
    this.#storage?.init({
      name: options.name,
      id: options.id,
      schema: options.schema,
      schemaVersion: options.schemaVersion,
      validatePayload,
    })
    this.#isPersistent.set(options.storage !== null)
    this.#rows = new Store(options.schema)
    this.#store = store(options.schema, {
      getRowFromTable: this.#rows.getRowFromTable,
      subscribeToRowChanges: this.#rows.subscribeToRowChanges,
    })
    this.ready = this.#hydrateBootstrapsFromStorage()
    this.stats = {
      isPersistent: this.#isPersistent,
      bootstraps: this.#bootstraps,
      batches: this.#batches,
      mutationQueue: this.#mutationQueue,
      queries: this.#queries,
      errors: this.#errors,
    }
    const batchURL = absoluteURL('batchURL', options.batchURL)
    const bootstrapURL = absoluteURL('bootstrapURL', options.bootstrapURL)
    this.#coverage = new CoverageTracker(
      batchURL,
      this.#batches,
      validatePayload,
      response => this.#rows.addIfNotExist(response),
      this.#reporterFor,
      this.#storage,
    )
    this.#bootstrap = this.ready.then(
      () =>
        new Bootstrap(
          bootstrapURL,
          this.#bootstraps,
          validatePayload,
          rowsByTable => this.#rows.addIfNotExist(rowsByTable),
          this.#reporterFor,
        ),
    )
    const storage = this.#storage
    if (storage) {
      void this.ready.then(() => {
        let previous = this.#bootstraps.get()
        this.#bootstraps.subscribe(() => {
          const next = this.#bootstraps.get()
          for (const [tableName, state] of Object.entries(next)) {
            if (state && previous[tableName as TableName<S>] !== state) {
              const key = bootstrapKVKey(tableName)
              void Result.tryPromise({
                try: () =>
                  storage.transactionKVStore(async kv => {
                    await kv.put(key, state)
                  }),
                catch: error => error,
              }).then(result => {
                result.tapError(error => {
                  this.report({
                    type: 'persistence',
                    where: 'sssync',
                    offending: { store: key, key, error },
                  })
                })
              })
            }
          }
          previous = next
        })
      })
    }
  }

  async #hydrateBootstrapsFromStorage(): Promise<void> {
    const storage = this.#storage
    if (!storage) return

    const snapshot: Record<string, BootstrapState> = {}
    const result = await Result.tryPromise({
      try: () =>
        storage.transactionKVStore(async kv => {
          for (const tableName of Object.keys(this.schema.tables)) {
            const key = bootstrapKVKey(tableName)
            const value = (await Result.tryPromise({ try: () => kv.get(key), catch: error => error }))
              .tapError(error => {
                this.report({ type: 'persistence', where: 'sssync', offending: { store: key, key, error } })
              })
              .unwrapOr(undefined)
            if (isBootstrapState(value)) {
              snapshot[tableName] = value
            }
          }
        }),
      catch: error => error,
    })

    result.tapError(error => {
      this.report({
        type: 'persistence',
        where: 'sssync',
        offending: { store: BOOTSTRAPS_KV_PREFIX, error },
      })
    })

    if (result.isOk() && Object.keys(snapshot).length > 0) {
      this.#bootstraps.set(snapshot as BootstrapsSnapshot<S>)
    }
  }

  get isPersistent(): ReadonlyObservable<boolean> {
    return this.#isPersistent
  }

  get bootstraps(): ReadonlyObservable<BootstrapsSnapshot<S>> {
    return this.#bootstraps
  }

  get batches(): ReadonlyObservable<BatchStats> {
    return this.#batches
  }

  get mutationQueue(): ReadonlyObservable<readonly MutationEnvelope<Mutators<S, Definitions>>[]> {
    return this.#mutationQueue
  }

  get queries(): ReadonlyObservable<Readonly<Record<string, QueryDetails>>> {
    return this.#queries
  }

  get errors(): ReadonlyObservable<readonly (Failure & { where: Where })[]> {
    return this.#errors
  }

  report(error: Failure & { where: Where }): void {
    console.error(`[sssync:${error.where}] ${describe(error)}`)
    this.#errors.set([error, ...this.#errors.get()].slice(0, this.#maxErrors))
  }

  // Mints a Reporter bound to `where`; subsystems get this so their own bodies
  // never touch `where`, and pass it along to anything they build.
  #reporterFor = (where: Where): Reporter => {
    return failure => this.report({ ...failure, where })
  }

  async bootstrapload<Name extends TableName<S>>(table: Name): Promise<readonly RowOf<Tables<S>[Name]>[] | undefined> {
    const bootstrap = await this.#bootstrap
    return bootstrap.load(table) as Promise<readonly RowOf<Tables<S>[Name]>[] | undefined>
  }

  all<Name extends TableName<S>>(table: Name): Query<readonly RowOf<Tables<S>[Name]>[], AllQueryPlan<Name>> {
    return this.#store.all(table)
  }

  one<Name extends TableName<S>, const Relations extends readonly RelationName<S, Name>[] = readonly []>(
    table: Name,
    args: OneArgs<S, Name, Relations>,
  ): Query<RowWithIncludes<S, Name, Relations> | undefined, OneQueryPlan<Name, Relations>> {
    return this.#store.one(table, { id: args.id, include: args.relations })
  }
}

// Requires an absolute URL and strips any trailing slash, so callers can append
// paths/query strings (e.g. `${url}?model=...`) without a double slash.
function absoluteURL(label: string, url: string): string {
  const parsed = attempt(() => new URL(url), error => error)
  return parsed.ok ? url.replace(/\/+$/, '') : panic(`Invalid ${label}: ${JSON.stringify(url)}`)
}

function bootstrapKVKey(tableName: string): string {
  return `${BOOTSTRAPS_KV_PREFIX}:${tableName}`
}

const bootstrapStateSchema = object({
  status: enums(['pending', 'success', 'error']),
  error: optional(string()),
})

function isBootstrapState(value: unknown): value is BootstrapState {
  return safeValidate(bootstrapStateSchema, value).isOk()
}
