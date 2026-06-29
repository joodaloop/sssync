import { Observable, type ReadonlyObservable } from '../shared'
import type { BootstrapsSnapshot } from '../bootstrap'
import type { QueryDetails } from '../query'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import type {
  AnyMutatorDefinition,
  MutationEnvelope,
  Mutators,
} from '../mutators'

export type { BootstrapState, BootstrapsSnapshot } from '../bootstrap'

// In-flight batching activity: requests waiting on the debounce timer (`pending`)
// versus requests already sent to the server (`inflight`).
export type BatchStats = {
  readonly pending: number
  readonly inflight: number
}

// Active queries and their status, keyed by query key.
export type QueriesSnapshot = Readonly<Record<string, QueryDetails>>

export type MutationQueueSnapshot<Registry extends Mutators<any, any>> =
  readonly MutationEnvelope<Registry>[]

export type StatsOptions<
  S extends ClientDatabaseSchema,
  Definitions extends { [K in keyof Definitions]: AnyMutatorDefinition<S> },
> = {
  readonly bootstraps: Observable<BootstrapsSnapshot<S>>
  readonly mutators: Mutators<S, Definitions>
  readonly isPersistent?: boolean
  readonly maxErrors?: number
}

export type WorkErrorSource =
  | 'bootstrap'
  | 'batch'
  | 'coverage'
  | 'channel'
  | 'leader'

// A normalized record of a single operational/diagnostic failure, reported by a
// subsystem for observability. Subsystems still own their own control flow (a
// failed bootstrap still transitions to 'error', a failed batch still resolves
// `success: false`); this is the read side only.
export type WorkError = {
  readonly source: WorkErrorSource
  // The thing that failed: a model name, an item cache key, a channel name, etc.
  readonly key: string
  readonly message: string
  readonly timestamp: number
  // Whether retrying the same work could plausibly succeed (a network failure)
  // versus a permanent rejection (an invalid row, an unknown model).
  readonly retryable: boolean
}

// What `report` receives — the caller supplies everything but the timestamp,
// which Stats stamps so every record shares one clock.
export type WorkErrorInput = Omit<WorkError, 'timestamp'>

// A readonly view of in-progress and failed work, written to by the subsystems
// (bootstrap, batcher, coverage, ...) and read by developers anywhere in the app.
//
// Each field is a ReadonlyObservable, so a framework wrapper binds to exactly the
// field it renders — `from(set => obs.subscribe(...))` in Solid,
// `useSyncExternalStore(obs.subscribe, obs.get)` in React — without the core
// depending on any UI framework.
export class Stats<
  S extends ClientDatabaseSchema,
  Definitions extends {
    [K in keyof Definitions]: AnyMutatorDefinition<S>
  },
> {
  readonly mutators: Mutators<S, Definitions>
  // Whether writes are being persisted to IndexedDB (vs. memory-only).
  readonly #isPersistent: Observable<boolean>
  // Per-model bootstrap status.
  readonly #bootstraps: Observable<BootstrapsSnapshot<S>>
  // In-flight batch request counts.
  readonly #batches = new Observable<BatchStats>({ pending: 0, inflight: 0 })
  // Local mutations queued but not yet confirmed by the server.
  readonly #mutationQueue = new Observable<
    MutationQueueSnapshot<Mutators<S, Definitions>>
  >([])
  // Active queries keyed by query key, with their current status.
  readonly #queries = new Observable<QueriesSnapshot>({})

  // Mutable backing log, newest first, capped at `maxErrors` so a long-lived
  // session with a flapping connection can't grow it without bound.
  readonly #errorsLog: WorkError[] = []
  // The published snapshot. Held as the full Observable internally so `report`
  // can `set` it, but exposed only as a ReadonlyObservable.
  readonly #errors = new Observable<readonly WorkError[]>([])

  constructor(options: StatsOptions<S, Definitions>) {
    this.mutators = options.mutators
    this.#bootstraps = options.bootstraps
    this.#isPersistent = new Observable(options.isPersistent ?? false)
    this.maxErrors = options.maxErrors ?? 100
  }

  private readonly maxErrors: number

  get isPersistent(): ReadonlyObservable<boolean> {
    return this.#isPersistent
  }

  get bootstraps(): ReadonlyObservable<BootstrapsSnapshot<S>> {
    return this.#bootstraps
  }

  get batches(): ReadonlyObservable<BatchStats> {
    return this.#batches
  }

  get mutationQueue(): ReadonlyObservable<
    MutationQueueSnapshot<Mutators<S, Definitions>>
  > {
    return this.#mutationQueue
  }

  get queries(): ReadonlyObservable<QueriesSnapshot> {
    return this.#queries
  }

  // Newest-first snapshot of recorded errors. Its identity changes only when the
  // log changes, so reads between changes are referentially equal.
  get errors(): ReadonlyObservable<readonly WorkError[]> {
    return this.#errors
  }

  // Called by a subsystem when a unit of work fails. Stamps the record, prepends
  // it (dropping the oldest past the cap), and publishes a new snapshot.
  report(error: WorkErrorInput): void {
    this.#errorsLog.unshift({ ...error, timestamp: Date.now() })
    if (this.#errorsLog.length > this.maxErrors) {
      this.#errorsLog.length = this.maxErrors
    }
    this.#errors.set([...this.#errorsLog])
  }
}
