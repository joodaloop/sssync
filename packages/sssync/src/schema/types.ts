import type { TableSchema } from './table-schema'

export type {
  Cardinality,
  PrimaryKey,
  Relationship,
  RelationshipsSchema,
  Schema,
  TableSchema,
} from './table-schema'

export type {
  ColumnTypeName,
  SchemaValue,
  SchemaValueToTSType,
  SchemaValueWithCustomType,
  TypeNameToTypeMap,
  ValueType,
} from './schema-value'

export type TableSchemaMap = Record<string, TableSchema>
