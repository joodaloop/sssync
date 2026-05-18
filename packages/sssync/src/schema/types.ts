import type { TableSchema } from '../../../vendored/zero/zero-types/src/schema'

export type {
  Cardinality,
  PrimaryKey,
  Relationship,
  RelationshipsSchema,
  Schema,
  TableSchema,
} from '../../../vendored/zero/zero-types/src/schema'

export type {
  ColumnTypeName,
  SchemaValue,
  SchemaValueToTSType,
  SchemaValueWithCustomType,
  TypeNameToTypeMap,
  ValueType,
} from '../../../vendored/zero/zero-types/src/schema-value'

export type TableSchemaMap = Record<string, TableSchema>
