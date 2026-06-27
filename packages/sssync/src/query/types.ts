import type {
  IdInputOf,
  RowOf,
  TableName,
  Tables,
} from '../schema/infer'
import type {
  Cardinality,
  ClientDatabaseSchema,
  Relationship,
} from '../schema/table-schema'

declare const queryValue: unique symbol

export type RelationshipTables<S extends ClientDatabaseSchema> = {
  [K in keyof S['relationships'] as string extends K
    ? never
    : K]: S['relationships'][K]
}

type RelationshipsFor<
  S extends ClientDatabaseSchema,
  Name extends string,
> = Name extends keyof RelationshipTables<S> ? RelationshipTables<S>[Name] : {}

export type RelationName<
  S extends ClientDatabaseSchema,
  Name extends string,
> = keyof RelationshipsFor<S, Name> & string

type RelationshipFor<
  S extends ClientDatabaseSchema,
  Name extends string,
  RelName extends string,
> = RelName extends keyof RelationshipsFor<S, Name>
  ? RelationshipsFor<S, Name>[RelName]
  : never

type LastConnection<R> =
  R extends readonly [infer Only]
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

export type AllQueryPlan<Name extends string = string> = {
  readonly kind: 'all'
  readonly table: Name
}

export type OneQueryPlan<Name extends string = string> = {
  readonly kind: 'one'
  readonly table: Name
  readonly id: unknown
}

export type RelationQueryPlan<
  SourceName extends string = string,
  RelName extends string = string,
  DestName extends string = string,
  C extends Cardinality = Cardinality,
  R extends Relationship = Relationship,
> = {
  readonly kind: 'relation'
  readonly parent: QueryPlan
  readonly sourceTable: SourceName
  readonly relation: RelName
  readonly destTable: DestName
  readonly cardinality: C
  readonly relationship: R
}

export type QueryPlan = AllQueryPlan | OneQueryPlan | RelationQueryPlan

export type Query<T, Plan extends QueryPlan = QueryPlan> = {
  readonly key: string
  readonly plan: Plan
  readonly [queryValue]?: readonly [T]
}

export type QueryValue<Q> = Q extends Query<infer T> ? T : never

export type RelationQueries<
  S extends ClientDatabaseSchema,
  Name extends TableName<S>,
> = {
  readonly [RelName in RelationName<S, Name>]: RelationQuery<
    S,
    Name,
    RelName
  >
}

export type RowQuery<
  S extends ClientDatabaseSchema,
  Name extends TableName<S>,
  Plan extends QueryPlan = OneQueryPlan<Name>,
> = Query<RowOf<Tables<S>[Name]> | undefined, Plan> &
  RelationQueries<S, Name>

export type RelationQuery<
  S extends ClientDatabaseSchema,
  Name extends TableName<S>,
  RelName extends RelationName<S, Name>,
> =
  RelationshipFor<S, Name, RelName> extends infer R
    ? R extends Relationship
      ? RelationshipDestination<R> extends infer Dest
        ? Dest extends TableName<S>
          ? RelationshipCardinality<R> extends 'many'
            ? Query<
                readonly RowOf<Tables<S>[Dest]>[],
                RelationQueryPlan<Name, RelName, Dest, 'many', R>
              >
            : RowQuery<
                S,
                Dest,
                RelationQueryPlan<Name, RelName, Dest, 'one', R>
              >
          : never
        : never
      : never
    : never

export type TableQuery<
  S extends ClientDatabaseSchema,
  Name extends TableName<S>,
> = {
  all(): Query<readonly RowOf<Tables<S>[Name]>[], AllQueryPlan<Name>>
  one(id: IdInputOf<Tables<S>[Name]>): RowQuery<S, Name>
}

export type QueryStore<S extends ClientDatabaseSchema> = {
  readonly [Name in TableName<S>]: TableQuery<S, Name>
}
