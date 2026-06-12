import type {
  Relationship,
  Schema,
  SchemaValueToTSType,
  TableSchema,
} from '../../sssync/src/schema/types'

export type TableName<TSchema extends Schema> = keyof TSchema['tables'] & string

export type RelationshipName<
  TSchema extends Schema,
  TTable extends TableName<TSchema>,
> = keyof TSchema['relationships'][TTable] & string

export type RowForTable<TTable extends TableSchema> = {
  readonly [K in keyof TTable['columns'] & string]: SchemaValueToTSType<
    TTable['columns'][K]
  >
}

export type RowFor<
  TSchema extends Schema,
  TTable extends TableName<TSchema>,
> = RowForTable<TSchema['tables'][TTable]>

export type FieldName<TRow> = keyof TRow & string

export type FieldValue<TRow, TField extends FieldName<TRow>> = TRow[TField]

export type ComparableField<TRow> = {
  readonly [K in FieldName<TRow>]: NonNullable<TRow[K]> extends number
    ? K
    : never
}[FieldName<TRow>]

export type StringField<TRow> = {
  readonly [K in FieldName<TRow>]: NonNullable<TRow[K]> extends string
    ? K
    : never
}[FieldName<TRow>]

export type Scalar = string | number | boolean | null

export type ComparisonOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'is'
  | 'isNot'

export type ComparisonExpression = {
  readonly type: 'comparison'
  readonly op: ComparisonOperator
  readonly field: string
  readonly value: Scalar | readonly Scalar[]
}

export type LogicalExpression = {
  readonly type: 'and' | 'or'
  readonly expressions: readonly WhereExpression[]
}

export type NotExpression = {
  readonly type: 'not'
  readonly expression: WhereExpression
}

export type WhereExpression =
  | ComparisonExpression
  | LogicalExpression
  | NotExpression

export type WhereStage = {
  readonly type: 'where'
  readonly expression: WhereExpression
}

export type RelatedStage = {
  readonly type: 'related'
  readonly name: string
  readonly sourceTable: string
  readonly targetTable: string
  readonly relationship: Relationship
}

export type QueryStage = WhereStage | RelatedStage

export type QueryMode =
  | { readonly type: 'many' }
  | { readonly type: 'single'; readonly id: Scalar | readonly Scalar[] }

export type QuerySpec = {
  readonly table: string
  readonly mode: QueryMode
  readonly stages: readonly QueryStage[]
}

export type RelatedTarget<
  TRelationship extends Relationship,
> = TRelationship extends readonly [infer Only]
  ? Only extends { readonly destSchema: infer TDest }
    ? TDest & string
    : never
  : TRelationship extends readonly [unknown, infer Last]
    ? Last extends { readonly destSchema: infer TDest }
      ? TDest & string
      : never
    : never

export type TargetTableForRelationship<
  TSchema extends Schema,
  TTable extends TableName<TSchema>,
  TRelationship extends RelationshipName<TSchema, TTable>,
> = RelatedTarget<TSchema['relationships'][TTable][TRelationship]> &
  TableName<TSchema>
