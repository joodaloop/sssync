import type { ClientDatabaseSchema } from '../schema/table-schema'
import { primaryKeyFor } from '../shared'
import type { Query, QueryPlan, QueryStore } from './types'

/**
 * UI rendering libraries will often provide a utility for batching multiple
 * state updates into a single render. Some examples are React's
 * `unstable_batchedUpdates`, and solid-js's `batch`.
 *
 * This option enables integrating these batch utilities with Zero.
 *
 * When `batchViewUpdates` is provided, Zero will call it whenever
 * it updates query view state with an `applyViewUpdates` function
 * that performs the actual state updates.
 *
 * Zero updates query view state when:
 * 1. creating a new view
 * 2. updating all existing queries' views to a new consistent state
 *
 * When creating a new view, that single view's creation will be wrapped
 * in a `batchViewUpdates` call.
 *
 * When updating existing queries, all queries will be updated in a single
 * `batchViewUpdates` call, so that the transition to the new consistent
 * state can be done in a single render.
 *
 * Implementations must always call `applyViewUpdates` synchronously.
 */

export function store<const S extends ClientDatabaseSchema>(schema: S): QueryStore<S> {
  return {
    all: (table: string) => {
      if (!schema.tables[table]) {
        throw new Error(`Unknown table "${table}"`)
      }

      return createQuery({
        key: table,
        accessKeys: [table],
        plan: { kind: 'all', table },
      })
    },
    one: (table: string, options: { id: unknown; include?: readonly string[] }) => {
      if (!schema.tables[table]) {
        throw new Error(`Unknown table "${table}"`)
      }

      const include = options.include ?? []
      const baseKey = `${table}:${primaryKeyFor(schema.tables[table], options.id)}`

      return createQuery({
        key: keyWithIncludes(baseKey, include),
        accessKeys: [baseKey, ...include.map(relation => `${baseKey}:${relation}`)],
        plan: {
          kind: 'one',
          table,
          id: options.id,
          include,
        },
      })
    },
  } as QueryStore<S>
}

function createQuery<T>(query: {
  readonly key: string
  readonly accessKeys: readonly string[]
  readonly plan: QueryPlan
}): Query<T> {
  return query as Query<T>
}

function keyWithIncludes(baseKey: string, include: readonly string[]) {
  if (include.length === 0) {
    return baseKey
  }

  return `${baseKey}?include=${[...include].sort().join(',')}`
}
