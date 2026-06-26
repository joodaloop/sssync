import * as v from 'valibot'

const valueTypeSchema = v.picklist([
  'string',
  'number',
  'boolean',
  'null',
  'json',
] as const)

const fieldListSchema = v.pipe(
  v.array(v.pipe(v.string(), v.minLength(1))),
  v.minLength(1),
)

export const schemaValueSchema = v.object({
  type: valueTypeSchema,
  optional: v.optional(v.boolean()),
  customType: v.optional(v.unknown()),
})

export const tableSchemaSchema = v.object({
  name: v.string(),
  columns: v.record(v.string(), schemaValueSchema),
  primaryKey: fieldListSchema,
})

const relationshipPart = v.object({
  sourceField: fieldListSchema,
  destField: fieldListSchema,
  destSchema: v.string(),
  cardinality: v.picklist(['one', 'many'] as const),
})

export const relationshipSchema = v.union([
  v.tuple([relationshipPart]),
  v.tuple([relationshipPart, relationshipPart]),
])

export const schemaSchema = v.object({
  tables: v.record(v.string(), tableSchemaSchema),
  relationships: v.optional(
    v.record(v.string(), v.record(v.string(), relationshipSchema)),
  ),
})
