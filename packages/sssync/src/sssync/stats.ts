import type { BootstrapsSnapshot } from '../bootstrap'
import type {
  AnyMutatorDefinition,
  Mutators,
  MutationEnvelope,
} from '../mutators'
import type { QueryDetails } from '../query'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import type { BatchStats, ReadonlyObservable, WorkError } from '../shared'

export type { BatchStats, WorkError } from '../shared'

// Readonly compatibility facade for the observables owned by SSSync.
export class Stats<
  S extends ClientDatabaseSchema,
  Definitions extends {
    [K in keyof Definitions]: AnyMutatorDefinition<S>
  },
> {
  constructor(
    private readonly observables: {
      readonly isPersistent: ReadonlyObservable<boolean>
      readonly bootstraps: ReadonlyObservable<BootstrapsSnapshot<S>>
      readonly batches: ReadonlyObservable<BatchStats>
      readonly mutationQueue: ReadonlyObservable<
        readonly MutationEnvelope<Mutators<S, Definitions>>[]
      >
      readonly queries: ReadonlyObservable<Readonly<Record<string, QueryDetails>>>
      readonly errors: ReadonlyObservable<readonly WorkError[]>
    },
  ) {}

  get isPersistent(): ReadonlyObservable<boolean> {
    return this.observables.isPersistent
  }

  get bootstraps(): ReadonlyObservable<BootstrapsSnapshot<S>> {
    return this.observables.bootstraps
  }

  get batches(): ReadonlyObservable<BatchStats> {
    return this.observables.batches
  }

  get mutationQueue(): ReadonlyObservable<
    readonly MutationEnvelope<Mutators<S, Definitions>>[]
  > {
    return this.observables.mutationQueue
  }

  get queries(): ReadonlyObservable<Readonly<Record<string, QueryDetails>>> {
    return this.observables.queries
  }

  get errors(): ReadonlyObservable<readonly WorkError[]> {
    return this.observables.errors
  }
}
