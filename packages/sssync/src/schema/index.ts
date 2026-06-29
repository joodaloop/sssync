export { relationships } from './builder/relationship-builder'
export { createSchema, hashSchema } from './builder/schema-builder'
export { rowSchemaFor } from './row-schema'
export { boolean, column, enumeration, json, number, string, table } from './builder/table-builder'

export type { Relationships } from './builder/relationship-builder'
export type { ColumnBuilder, TableBuilder, TableBuilderWithColumns } from './builder/table-builder'
export type {
  Cardinality,
  ClientDatabaseSchema,
  // LastInTuple,
  Relationship,
  RelationshipsSchema,
  TableMap,
  TableSchema,
} from './table-schema'
export type {
  ColumnTypeName,
  JSONValue,
  SchemaValue,
  SchemaValueToTSType,
  SchemaValueWithCustomType,
  TypeNameToTypeMap,
  ValueType,
} from './schema-value'
export type { IdInputOf, IdOf, RowOf, TableName, Tables } from './infer'
