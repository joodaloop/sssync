import { store } from '../query'
import type {
  AllQueryPlan,
  OneQueryPlan,
  Query,
  QueryStore,
  RelationName,
  RowWithIncludes,
} from '../query'
import type { IdInputOf, RowOf, TableName, Tables } from '../schema'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import type { AnyMutatorDefinition, Mutators } from '../mutators'

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
  readonly #store: QueryStore<S>

  constructor(options: SSSyncOptions<S, Definitions>) {
    this.schema = options.schema
    this.mutators = options.mutators
    this.#store = store(options.schema)
  }

  all<Name extends TableName<S>>(
    table: Name,
  ): Query<readonly RowOf<Tables<S>[Name]>[], AllQueryPlan<Name>> {
    return this.#store.all(table)
  }

  one<
    Name extends TableName<S>,
    const Relations extends readonly RelationName<S, Name>[] = readonly [],
  >(
    table: Name,
    args: OneArgs<S, Name, Relations>,
  ): Query<
    RowWithIncludes<S, Name, Relations> | undefined,
    OneQueryPlan<Name, Relations>
  > {
    return this.#store.one(table, { id: args.id, include: args.relations })
  }
}
