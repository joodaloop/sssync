import { Bootstrap } from '../bootstrap'
import type { BootstrapsSnapshot } from '../bootstrap'
import { CoverageTracker } from '../coverage'
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
import { Observable } from '../shared'
import type { BatchStats, ReadonlyObservable } from '../shared'
import { Store } from '../store'
import type { SyncError } from '../errors'

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
  readonly schema: S
  readonly mutators: Mutators<S, Definitions>
  readonly schemaVersion: number
  readonly batchURL: string
  readonly bootstrapURL: string
  readonly storage: null | IDBStorage
}

/**
 * The entry point of a sssync app. Holds the schema and mutators together and
 * builds query plans against them.
 *
 * ```ts
 * const sync = new SSSync({ schema, mutators })
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
  readonly #coverage: CoverageTracker
  readonly #bootstrap: Bootstrap<S>
  readonly #storage: null | IDBStorage
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
    this.#isPersistent = new Observable(options.storage !== null)
    this.#store = store(options.schema)
    this.#rows = new Store(options.schema)
    this.#batches = new Observable<BatchStats>({ pending: [], inflight: [] })
    this.#bootstraps = new Observable<BootstrapsSnapshot<S>>({})
    this.#mutationQueue = new Observable<readonly MutationEnvelope<Mutators<S, Definitions>>[]>([])
    this.#queries = new Observable<Readonly<Record<string, QueryDetails>>>({})
    this.#errors = new Observable<readonly SyncError[]>([])
    this.#maxErrors = 100
    this.stats = {
      isPersistent: this.#isPersistent,
      bootstraps: this.#bootstraps,
      batches: this.#batches,
      mutationQueue: this.#mutationQueue,
      queries: this.#queries,
      errors: this.#errors,
    }
    this.#coverage = new CoverageTracker(options.schema, options.batchURL, this.#batches, response =>
      this.#rows.addIfNotExist(response),
    )
    this.#bootstrap = new Bootstrap(options.schema, options.bootstrapURL, this.#bootstraps)
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
