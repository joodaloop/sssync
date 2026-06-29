import { mapEntries } from '../../shared'
import type { JSONValue, SchemaValue } from '../schema-value'
import type { PrimaryKey, TableSchema } from '../table-schema'

type ColumnMap = Record<string, ColumnBuilder<SchemaValue>>
type BuiltColumns<TColumns extends ColumnMap> = {
  readonly [K in keyof TColumns]: TColumns[K]['schema']
}

/* oxlint-disable @typescript-eslint/no-explicit-any */
export function table<TName extends string>(name: TName) {
  return new TableBuilder({
    name,
    columns: {},
    primaryKey: [] as any as PrimaryKey,
  })
}

export function string<T extends string = string>() {
  return new ColumnBuilder({
    type: 'string',
    optional: false,
    customType: null as unknown as T,
  })
}

export function number<T extends number = number>() {
  return new ColumnBuilder({
    type: 'number',
    optional: false,
    customType: null as unknown as T,
  })
}

export function boolean<T extends boolean = boolean>() {
  return new ColumnBuilder({
    type: 'boolean',
    optional: false,
    customType: null as unknown as T,
  })
}

export function json<T extends JSONValue = JSONValue>() {
  return new ColumnBuilder({
    type: 'json',
    optional: false,
    customType: null as unknown as T,
  })
}

export function enumeration<T extends string>() {
  return new ColumnBuilder({
    type: 'string',
    optional: false,
    customType: null as unknown as T,
  })
}

export const column = {
  string,
  number,
  boolean,
  json,
  enumeration,
}

export class TableBuilder<TShape extends TableSchema> {
  readonly #schema: TShape
  constructor(schema: TShape) {
    this.#schema = schema
  }

  columns<const TColumns extends ColumnMap>(
    columns: TColumns,
  ): TableBuilderWithColumns<{
    name: TShape['name']
    columns: BuiltColumns<TColumns>
    primaryKey: TShape['primaryKey']
  }> {
    const columnSchemas = mapEntries(columns, (k, v) => [k, v.schema]) as BuiltColumns<TColumns>
    return new TableBuilderWithColumns({
      ...this.#schema,
      columns: columnSchemas,
    }) as any
  }
}

export class TableBuilderWithColumns<TShape extends TableSchema> {
  readonly #schema: TShape

  constructor(schema: TShape) {
    this.#schema = schema
  }

  primaryKey<TPKColNames extends (keyof TShape['columns'] & string)[]>(...pkColumnNames: TPKColNames) {
    return new TableBuilderWithColumns({
      ...this.#schema,
      primaryKey: pkColumnNames,
    })
  }

  get schema() {
    return this.#schema
  }

  build() {
    // We can probably get the type system to throw an error if primaryKey is not called
    // before passing the schema to createSchema
    // Till then --
    if (this.#schema.primaryKey.length === 0) {
      throw new Error(`Table "${this.#schema.name}" is missing a primary key`)
    }
    for (const columnName of this.#schema.primaryKey) {
      const col = this.#schema.columns[columnName]
      if (col.type === 'json') {
        throw new Error(`Primary key column "${this.#schema.name}"."${columnName}" cannot be json`)
      }
    }
    return this.#schema
  }
}

class ColumnBuilder<TShape extends SchemaValue<any>> {
  readonly #schema: TShape
  constructor(schema: TShape) {
    this.#schema = schema
  }

  optional(): ColumnBuilder<Omit<TShape, 'optional'> & { optional: true }> {
    return new ColumnBuilder({
      ...this.#schema,
      optional: true,
    })
  }

  get schema() {
    return this.#schema
  }
}

export type { ColumnBuilder }
