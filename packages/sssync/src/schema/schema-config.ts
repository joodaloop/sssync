import * as j from '../json-validator'

const valueTypeSchema = j.picklist([
  'string',
  'number',
  'boolean',
  'null',
  'json',
] as const)

const fieldListSchema = j.minLength(j.array(j.minLength(j.string(), 1)), 1)

export const schemaValueSchema = j.object({
  type: valueTypeSchema,
  optional: j.optional(j.boolean()),
  customType: j.optional(j.unknown()),
})

export const tableSchemaSchema = j.object({
  name: j.string(),
  columns: j.record(j.string(), schemaValueSchema),
  primaryKey: fieldListSchema,
})

const relationshipPart = j.object({
  sourceField: fieldListSchema,
  destField: fieldListSchema,
  destSchema: j.string(),
  cardinality: j.picklist(['one', 'many'] as const),
})

export const relationshipSchema = j.union([
  j.tuple([relationshipPart]),
  j.tuple([relationshipPart, relationshipPart]),
])

export const schemaSchema = j.object({
  tables: j.record(j.string(), tableSchemaSchema),
  relationships: j.optional(
    j.record(j.string(), j.record(j.string(), relationshipSchema)),
  ),
})
