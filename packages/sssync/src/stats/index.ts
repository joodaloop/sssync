import {
  Observable,
  type BatchStats,
  type ReadonlyObservable,
  type WorkError,
} from '../shared'
import type { BootstrapsSnapshot } from '../bootstrap'
import type { QueryDetails } from '../query'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import type {
  AnyMutatorDefinition,
  MutationEnvelope,
  Mutators,
} from '../mutators'

export type { BatchStats, WorkError } from '../shared'

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
  // In-flight batch request snapshots.
  readonly #batches: Observable<BatchStats>
  // Local mutations queued but not yet confirmed by the server.
  readonly #mutationQueue = new Observable<
    readonly MutationEnvelope<Mutators<S, Definitions>>[]
  >([])
  // Active queries keyed by query key, with their current status.
  readonly #queries = new Observable<Readonly<Record<string, QueryDetails>>>({})

  // Newest first, capped at `maxErrors` so a long-lived session with a flapping
  // connection can't grow it without bound.
  readonly #errors = new Observable<readonly WorkError[]>([])

  constructor(options: {
    readonly bootstraps: Observable<BootstrapsSnapshot<S>>
    readonly batches: Observable<BatchStats>
    readonly mutators: Mutators<S, Definitions>
    readonly isPersistent?: boolean
    readonly maxErrors?: number
  }) {
    this.mutators = options.mutators
    this.#bootstraps = options.bootstraps
    this.#batches = options.batches
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
    readonly MutationEnvelope<Mutators<S, Definitions>>[]
  > {
    return this.#mutationQueue
  }

  get queries(): ReadonlyObservable<Readonly<Record<string, QueryDetails>>> {
    return this.#queries
  }

  // Newest-first snapshot of recorded errors. Its identity changes only when the
  // log changes, so reads between changes are referentially equal.
  get errors(): ReadonlyObservable<readonly WorkError[]> {
    return this.#errors
  }

  // Called by a subsystem when a unit of work fails. Stamps the record, prepends
  // it (dropping the oldest past the cap), and publishes a new snapshot.
  report(error: Omit<WorkError, 'timestamp'>): void {
    this.#errors.set([
      { ...error, timestamp: Date.now() },
      ...this.#errors.get(),
    ].slice(0, this.maxErrors))
  }
}
