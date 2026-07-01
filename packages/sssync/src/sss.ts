import { describe } from './better'
import type { Reported } from './better'
import { Bootstrap } from './bootstrap'
import type { BootstrapsSnapshot } from './bootstrap'
import { CoverageTracker } from './coverage'
import type { IDBStorage } from './idb/types'
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
import { isRecord, Observable } from './shared'
import type { BatchStats, ReadonlyObservable } from './shared'
import { Store } from './store'
import { rowValidatorsFor, validateRowsByTable } from './validate'

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
    readonly errors: ReadonlyObservable<readonly Reported[]>
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
  readonly #errors = new Observable<readonly Reported[]>([])
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
    this.#rows = new Store(options.schema, error => this.report(error))
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
      error => this.report(error),
      this.#storage,
    )
    this.#bootstrap = this.ready.then(
      () =>
        new Bootstrap(
          bootstrapURL,
          this.#bootstraps,
          validatePayload,
          rowsByTable => this.#rows.addIfNotExist(rowsByTable),
          error => this.report(error),
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
                    type: 'persistence',
                    where: 'sssync',
                    offending: { store: key, key, error },
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
              type: 'persistence',
              where: 'sssync',
              offending: { store: key, key, error },
            })
          }
        }
      })

      if (Object.keys(snapshot).length > 0) {
        this.#bootstraps.set(snapshot as BootstrapsSnapshot<S>)
      }
    } catch (error) {
      this.report({
        type: 'persistence',
        where: 'sssync',
        offending: { store: BOOTSTRAPS_KV_PREFIX, error },
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

  get errors(): ReadonlyObservable<readonly Reported[]> {
    return this.#errors
  }

  report(error: Reported): void {
    console.error(`[sssync:${error.where}] ${describe(error)}`)
    this.#errors.set([error, ...this.#errors.get()].slice(0, this.#maxErrors))
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
