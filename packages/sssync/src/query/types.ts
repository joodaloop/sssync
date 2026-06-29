import type { IdInputOf, RowOf, TableName, Tables } from '../schema/infer'
import type { Cardinality, ClientDatabaseSchema } from '../schema/table-schema'
import type { GetRowFromTable, SubscribeToRowChanges } from '../store'

declare const queryValue: unique symbol

type RelationshipTables<S extends ClientDatabaseSchema> = {
  [K in keyof S['relationships'] as string extends K ? never : K]: S['relationships'][K]
}

type RelationshipsFor<S extends ClientDatabaseSchema, Name extends string> = Name extends keyof RelationshipTables<S>
  ? RelationshipTables<S>[Name]
  : {}

export type RelationName<S extends ClientDatabaseSchema, Name extends string> = keyof RelationshipsFor<S, Name> & string

type RelationshipFor<
  S extends ClientDatabaseSchema,
  Name extends string,
  RelName extends string,
> = RelName extends keyof RelationshipsFor<S, Name> ? RelationshipsFor<S, Name>[RelName] : never

type LastConnection<R> = R extends readonly [infer Only]
  ? Only
  : R extends readonly [unknown, infer Last]
    ? Last
    : never

type RelationshipDestination<R> =
  LastConnection<R> extends {
    readonly destSchema: infer Dest extends string
  }
    ? Dest
    : never

type RelationshipCardinality<R> =
  LastConnection<R> extends {
    readonly cardinality: infer C extends Cardinality
  }
    ? C
    : never

type RelationValue<S extends ClientDatabaseSchema, Name extends TableName<S>, RelName extends RelationName<S, Name>> =
  RelationshipDestination<RelationshipFor<S, Name, RelName>> extends infer Dest
    ? Dest extends TableName<S>
      ? RelationshipCardinality<RelationshipFor<S, Name, RelName>> extends 'many'
        ? readonly RowOf<Tables<S>[Dest]>[]
        : RowOf<Tables<S>[Dest]> | undefined
      : never
    : never

export type RowWithIncludes<
  S extends ClientDatabaseSchema,
  Name extends TableName<S>,
  Include extends readonly RelationName<S, Name>[],
> = RowOf<Tables<S>[Name]> & {
  readonly [RelName in Include[number]]: RelationValue<S, Name, RelName>
}

export type OneQueryOptions<
  S extends ClientDatabaseSchema,
  Name extends TableName<S>,
  Include extends readonly RelationName<S, Name>[] = readonly [],
> = {
  readonly id: IdInputOf<Tables<S>[Name]>
  readonly include?: Include | undefined
}

export type AllQueryPlan<Name extends string = string> = {
  readonly kind: 'all'
  readonly table: Name
}

export type OneQueryPlan<Name extends string = string, Include extends readonly string[] = readonly string[]> = {
  readonly kind: 'one'
  readonly table: Name
  readonly id: unknown
  readonly include: Include
}

export type QueryPlan = AllQueryPlan | OneQueryPlan

export type QueryDetails = { readonly status: 'ready' } | { readonly status: 'error'; readonly error: Error }

export type Query<T, Plan extends QueryPlan = QueryPlan> = {
  readonly key: string
  readonly accessKeys: readonly string[]
  readonly plan: Plan
  readonly [queryValue]?: readonly [T]
}

export type QueryValue<Q> = Q extends Query<infer T> ? T : never

export type AllQueryFn<S extends ClientDatabaseSchema> = <Name extends TableName<S>>(
  table: Name,
) => Query<readonly RowOf<Tables<S>[Name]>[], AllQueryPlan<Name>>

export type OneQueryFn<S extends ClientDatabaseSchema> = <
  Name extends TableName<S>,
  const Include extends readonly RelationName<S, Name>[] = readonly [],
>(
  table: Name,
  options: OneQueryOptions<S, Name, Include>,
) => Query<RowWithIncludes<S, Name, Include> | undefined, OneQueryPlan<Name, Include>>

export type QueryStore<S extends ClientDatabaseSchema> = {
  readonly getRowFromTable: GetRowFromTable<S>
  readonly subscribeToRowChanges: SubscribeToRowChanges
  all: AllQueryFn<S>
  one: OneQueryFn<S>
}

export type QueryStoreSource<S extends ClientDatabaseSchema> = {
  readonly getRowFromTable: GetRowFromTable<S>
  readonly subscribeToRowChanges: SubscribeToRowChanges
}
