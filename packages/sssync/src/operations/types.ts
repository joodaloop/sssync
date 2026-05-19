import type {
  SchemaValue,
  SchemaValueToTSType,
  TableSchema,
  TableSchemaMap,
} from '../schema/types'

type OptionalKeys<T extends TableSchema> = {
  [K in keyof T['columns']]: T['columns'][K] extends { optional: true }
    ? K
    : never
}[keyof T['columns']]

type RequiredKeys<T extends TableSchema> = Exclude<
  keyof T['columns'],
  OptionalKeys<T>
>

export type Row<T extends TableSchema> = {
  [K in RequiredKeys<T>]: SchemaValueToTSType<T['columns'][K] & SchemaValue>
} & {
  [K in OptionalKeys<T>]?: SchemaValueToTSType<T['columns'][K] & SchemaValue>
}

export type PrimaryKeyRow<T extends TableSchema> = {
  [K in T['primaryKey'][number] & keyof T['columns']]: SchemaValueToTSType<
    T['columns'][K] & SchemaValue
  >
}

type TableName<S extends TableSchemaMap> = keyof S & string

export type StoreOperationAdd<
  S extends TableSchemaMap,
  T extends TableName<S> = TableName<S>,
> = {
  [N in T]: {
    type: 'add'
    table: N
    data: Row<S[N]>
  }
}[T]

export type StoreOperationUpdate<
  S extends TableSchemaMap,
  T extends TableName<S> = TableName<S>,
> = {
  [N in T]: {
    type: 'update'
    table: N
    key: PrimaryKeyRow<S[N]>
    data: Partial<Row<S[N]>>
  }
}[T]

export type StoreOperationRemove<
  S extends TableSchemaMap,
  T extends TableName<S> = TableName<S>,
> = {
  [N in T]: {
    type: 'remove'
    table: N
    key: PrimaryKeyRow<S[N]>
  }
}[T]

export type StoreOperation<S extends TableSchemaMap> =
  | StoreOperationAdd<S>
  | StoreOperationUpdate<S>
  | StoreOperationRemove<S>

export type StoreOperationInput<S extends TableSchemaMap> =
  | StoreOperation<S>
  | readonly StoreOperation<S>[]
