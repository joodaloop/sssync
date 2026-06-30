import { Bootstrap } from '../bootstrap'
import type { BootstrapsSnapshot } from '../bootstrap'
import { CoverageTracker } from '../coverage'
import type { SyncError } from '../errors'
import type { IDBStorage } from '../idb/types'
import type { AnyMutatorDefinition, MutationEnvelope, Mutators } from '../mutators'
import { store } from '../query'
import type {
  AllQueryPlan,
  OneQueryPlan,
  Query,
  QueryDetails,
  QueryStore,
  RelationName,
  RowWithIncludes,
} from '../query'
import type { IdInputOf, RowOf, TableName, Tables } from '../schema'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import { isRecord, Observable } from '../shared'
import type { BatchStats, ReadonlyObservable } from '../shared'
import { Store } from '../store'

const BOOTSTRAPS_KV_PREFIX = 'bootstraps'

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
    readonly errors: ReadonlyObservable<readonly SyncError[]>
  }
  readonly #store: QueryStore<S>
  readonly #rows: Store<S>
  readonly #coverage: CoverageTracker<S>
  readonly #bootstrap: Promise<Bootstrap<S>>
  readonly #storage: null | IDBStorage<S>
  readonly #isPersistent: Observable<boolean>
  readonly #bootstraps: Observable<BootstrapsSnapshot<S>>
  readonly #batches: Observable<BatchStats>
  readonly #mutationQueue: Observable<readonly MutationEnvelope<Mutators<S, Definitions>>[]>
  readonly #queries: Observable<Readonly<Record<string, QueryDetails>>>
  readonly #errors: Observable<readonly SyncError[]>
  readonly #maxErrors: number

  constructor(options: SSSyncOptions<S, Definitions>) {
    this.schema = options.schema
    this.mutators = options.mutators
    this.#storage = options.storage
    this.#storage?.init({
      name: options.name,
      id: options.id,
      schema: options.schema,
      schemaVersion: options.schemaVersion,
    })
    this.#isPersistent = new Observable(options.storage !== null)
    this.#rows = new Store(options.schema)
    this.#store = store(options.schema, {
      getRowFromTable: this.#rows.getRowFromTable,
      subscribeToRowChanges: this.#rows.subscribeToRowChanges,
    })
    this.#batches = new Observable<BatchStats>({ pending: [], inflight: [] })
    this.#bootstraps = new Observable<BootstrapsSnapshot<S>>({})
    this.#mutationQueue = new Observable<readonly MutationEnvelope<Mutators<S, Definitions>>[]>([])
    this.#queries = new Observable<Readonly<Record<string, QueryDetails>>>({})
    this.#errors = new Observable<readonly SyncError[]>([])
    this.#maxErrors = 100
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
      options.schema,
      batchURL,
      this.#batches,
      response => this.#rows.addIfNotExist(response),
      this.#storage,
      error => this.report(error),
    )
    this.#bootstrap = this.ready.then(
      () =>
        new Bootstrap(options.schema, bootstrapURL, this.#bootstraps, rowsByTable =>
          this.#rows.addIfNotExist(rowsByTable),
        ),
    )
    if (this.#storage) {
      void this.ready.then(() => {
        let previous = this.#bootstraps.get()
        this.#bootstraps.subscribe(() => {
          const next = this.#bootstraps.get()
          for (const [tableName, state] of Object.entries(next)) {
            if (state && previous[tableName as TableName<S>] !== state) {
              const key = bootstrapKVKey(tableName)
              this.#storage
                ?.transactionKVStore(async kv => {
                  await kv.put(key, state)
                })
                .catch(error => {
                  this.report({
                    type: 'persistence.write_failed',
                    store: key,
                    key,
                    cause: { message: String(error) },
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

    try {
      const snapshot: Record<string, unknown> = {}
      await storage.transactionKVStore(async kv => {
        for (const tableName of Object.keys(this.schema.tables)) {
          const key = bootstrapKVKey(tableName)
          try {
            const value = await kv.get(key)
            if (isBootstrapState(value)) {
              snapshot[tableName] = value
            }
          } catch (error) {
            this.report({
              type: 'persistence.read_failed',
              store: key,
              key,
              cause: { message: String(error) },
            })
          }
        }
      })

      if (Object.keys(snapshot).length > 0) {
        this.#bootstraps.set(snapshot as BootstrapsSnapshot<S>)
      }
    } catch (error) {
      this.report({
        type: 'persistence.read_failed',
        store: BOOTSTRAPS_KV_PREFIX,
        cause: { message: String(error) },
      })
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

  get errors(): ReadonlyObservable<readonly SyncError[]> {
    return this.#errors
  }

  report(error: SyncError): void {
    this.#errors.set([error, ...this.#errors.get()].slice(0, this.#maxErrors))
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
  try {
    new URL(url)
  } catch {
    throw new Error(`${label} must be an absolute URL, got "${url}"`)
  }
  return url.replace(/\/+$/, '')
}

function bootstrapKVKey(tableName: string): string {
  return `${BOOTSTRAPS_KV_PREFIX}:${tableName}`
}

function isBootstrapState(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.status !== 'pending' && value.status !== 'success' && value.status !== 'error') return false
  return value.error === undefined || typeof value.error === 'string'
}
