import type { StandardSchemaV1 } from '../types'
import type { JSONValue } from '../shared'
import type {
  IdInputOf,
  IdOf,
  RowOf,
  TableName,
  Tables,
} from '../schema/infer'
import type {
  ClientDatabaseSchema,
  TableSchema,
} from '../schema/table-schema'

export type InsertOf<T extends TableSchema> = Omit<
  RowOf<T>,
  T['primaryKey'][number]
>

export type UpdateOf<T extends TableSchema> = Partial<
  Omit<RowOf<T>, T['primaryKey'][number]>
>

export type InsertMutation<Name extends string, T extends TableSchema> = {
  type: 'INSERT'
  table: Name
  data: RowOf<T>
}

export type UpdateMutation<Name extends string, T extends TableSchema> = {
  type: 'UPDATE'
  table: Name
  id: IdOf<T>
  changes: UpdateOf<T>
}

export type DeleteMutation<Name extends string, T extends TableSchema> = {
  type: 'DELETE'
  table: Name
  id: IdOf<T>
}

export type MutationForTable<Name extends string, T extends TableSchema> =
  | InsertMutation<Name, T>
  | UpdateMutation<Name, T>
  | DeleteMutation<Name, T>

/**
 * A single typesafe mutation against the schema.
 *
 * Distributes over every table name so that once `table` is fixed, the rest
 * of the object is constrained to that table:
 *  - INSERT carries a full row.
 *  - UPDATE carries the row `id` plus a partial set of column changes.
 *  - DELETE carries only the row `id`.
 */
export type Mutation<S extends ClientDatabaseSchema> =
  TableName<S> extends infer Name
    ? Name extends TableName<S>
      ? MutationForTable<Name, Tables<S>[Name]>
      : never
    : never

export type TableMutationHelpers<Name extends string, T extends TableSchema> = {
  insert: (
    id: IdInputOf<T>,
    data: InsertOf<T>,
  ) => InsertMutation<Name, T>
  update: (
    id: IdInputOf<T>,
    changes: UpdateOf<T>,
  ) => UpdateMutation<Name, T>
  remove: (id: IdInputOf<T>) => DeleteMutation<Name, T>
}

export type MutationDb<S extends ClientDatabaseSchema> = {
  readonly [Name in TableName<S>]: TableMutationHelpers<Name, Tables<S>[Name]>
}

export type MutatorArgsSchema = StandardSchemaV1<unknown, JSONValue>

export type MutatorArgs<Args extends MutatorArgsSchema> =
  StandardSchemaV1.InferOutput<Args>

export type MutatorTx<S extends ClientDatabaseSchema> = {
  mutate: MutationDb<S>
}

export type MutatorEffect<
  S extends ClientDatabaseSchema,
  Args extends MutatorArgsSchema,
> = (context: {
  tx: MutatorTx<S>
  args: MutatorArgs<Args>
}) => void | Promise<void>

export type MutatorDefinition<
  S extends ClientDatabaseSchema,
  Args extends MutatorArgsSchema,
> = {
  args: Args
  effect: MutatorEffect<S, Args>
}

export type AnyMutatorDefinition<
  S extends ClientDatabaseSchema = ClientDatabaseSchema,
> = {
  args: MutatorArgsSchema
  effect: (context: any) => void | Promise<void>
}

export type DefineMutator<S extends ClientDatabaseSchema> = <
  const Args extends MutatorArgsSchema,
>(
  args: Args,
  effect: MutatorEffect<S, Args>,
) => MutatorDefinition<S, Args>

export type Mutators<
  S extends ClientDatabaseSchema,
  Definitions extends {
    [K in keyof Definitions]: AnyMutatorDefinition<S>
  },
> = {
  parse: (input: unknown) => MutationEnvelope<Mutators<S, Definitions>>
  apply: (
    envelope: MutationEnvelope<Mutators<S, Definitions>>,
  ) => Promise<readonly Mutation<S>[]>
}

export type MutationEnvelope<Registry extends Mutators<any, any>> =
  Registry extends Mutators<any, infer Definitions>
    ? {
        [Name in keyof Definitions & string]: {
          name: Name
          args: MutatorArgs<Definitions[Name]['args']>
        }
      }[keyof Definitions & string]
    : never
