import type { AnyMutatorDefinition } from '@sssync/sssync/mutators'
import type {
  AllQueryPlan,
  OneQueryPlan,
  Query,
  QueryDetails,
  QueryValue,
  RelationName,
  RowWithIncludes,
} from '@sssync/sssync/query'
import type { RowOf, TableName, Tables } from '@sssync/sssync/schema'
import type { ClientDatabaseSchema } from '@sssync/sssync/schema/table-schema'
import { SSSync, type OneArgs, type SSSyncOptions } from '@sssync/sssync/sssync'
import { createContext, createMemo, useContext, type Accessor, type JSX } from 'solid-js'

export type SSSProviderProps<Sync extends SSSync<any, any>> = {
  readonly sync?: Sync | Accessor<Sync>
  readonly children?: JSX.Element
}

export type UseQueryResult<Q extends Query<any>> = readonly [
  value: Accessor<QueryValue<Q>>,
  details: Accessor<QueryDetails>,
]

type UseAllResult<S extends ClientDatabaseSchema, Name extends TableName<S>> = UseQueryResult<
  Query<readonly RowOf<Tables<S>[Name]>[], AllQueryPlan<Name>>
>

type UseOneResult<
  S extends ClientDatabaseSchema,
  Name extends TableName<S>,
  Relations extends readonly RelationName<S, Name>[],
> = UseQueryResult<Query<RowWithIncludes<S, Name, Relations> | undefined, OneQueryPlan<Name, Relations>>>

/**
 * Creates an isolated Solid context for one SSSync configuration.
 *
 * ```ts
 * export const main = createSSSContext({ schema, mutators })
 * ```
 */
export function createSSSContext<
  S extends ClientDatabaseSchema,
  Definitions extends { [K in keyof Definitions]: AnyMutatorDefinition<S> },
>(options: SSSyncOptions<S, Definitions>) {
  type Sync = SSSync<S, Definitions>

  const SSSContext = createContext<Accessor<Sync>>()

  function SSSProvider(props: SSSProviderProps<Sync>): JSX.Element {
    const sync = createMemo(() => {
      const provided = props.sync

      if (typeof provided === 'function') {
        return provided()
      }

      return provided ?? (new SSSync(options) as Sync)
    })

    return SSSContext({
      get value() {
        return sync
      },
      get children() {
        return props.children
      },
    })
  }

  function useSSS(): Accessor<Sync> {
    const sync = useContext(SSSContext)

    if (!sync) {
      throw new Error('useSSS must be used within SSSProvider')
    }

    return sync
  }

  function useResolvedQuery<Q extends Query<any>>(build: () => Q): UseQueryResult<Q> {
    const result = createMemo(() => {
      const query = build()

      return {
        query,
        value: undefined as QueryValue<Q>,
        details: { status: 'ready' } as QueryDetails,
      }
    })

    return [() => result().value, () => result().details] as const
  }

  function useAll<Name extends TableName<S>>(table: Name): UseAllResult<S, Name> {
    const sync = useSSS()
    return useResolvedQuery(() => sync().all(table))
  }

  function useOne<Name extends TableName<S>, const Relations extends readonly RelationName<S, Name>[] = readonly []>(
    table: Name,
    args: OneArgs<S, Name, Relations>,
  ): UseOneResult<S, Name, Relations> {
    const sync = useSSS()
    return useResolvedQuery(() => sync().one(table, args))
  }

  return {
    SSSProvider,
    useSSS,
    useAll,
    useOne,
  }
}
