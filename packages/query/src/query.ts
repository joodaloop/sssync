import type { Schema } from '@sssync/zero-schema'
import { WhereBuilder } from './where-builder'
import type {
  QuerySpec,
  QueryStage,
  RelationshipName,
  RowFor,
  Scalar,
  TableName,
  TargetTableForRelationship,
  WhereExpression,
} from './types'

type AnyQuery = TableQuery<Schema, string & TableName<Schema>>

export class TableQuery<
  TSchema extends Schema,
  TTable extends TableName<TSchema>,
> {
  readonly #schema: TSchema
  readonly #table: string
  readonly #mode: QuerySpec['mode']
  readonly #stages: readonly QueryStage[]

  constructor(
    schema: TSchema,
    table: string,
    mode: QuerySpec['mode'] = { type: 'many' },
    stages: readonly QueryStage[] = [],
  ) {
    this.#schema = schema
    this.#table = table
    this.#mode = mode
    this.#stages = stages
  }

  where(
    build: (where: WhereBuilder<RowFor<TSchema, TTable>>) => WhereExpression,
  ): TableQuery<TSchema, TTable> {
    const builder = new WhereBuilder<RowFor<TSchema, TTable>>()

    return new TableQuery(this.#schema, this.#table, this.#mode, [
      ...this.#stages,
      { type: 'where', expression: build(builder) },
    ])
  }

  related<TRelationship extends RelationshipName<TSchema, TTable>>(
    name: TRelationship,
  ): TableQuery<TSchema, TargetTableForRelationship<TSchema, TTable, TRelationship>> {
    const relationship = this.#schema.relationships[this.#table]?.[name]

    if (!relationship) {
      throw new Error(
        `Unknown relationship "${name}" on table "${String(this.#table)}"`,
      )
    }

    const targetTable = relationship[relationship.length - 1].destSchema

    return new TableQuery<
      TSchema,
      TargetTableForRelationship<TSchema, TTable, TRelationship>
    >(
      this.#schema,
      targetTable,
      this.#mode,
      [
        ...this.#stages,
        {
          type: 'related',
          name,
          sourceTable: this.#table,
          targetTable,
          relationship,
        },
      ],
    )
  }

  single(id: Scalar | readonly Scalar[]): TableQuery<TSchema, TTable> {
    return new TableQuery(this.#schema, this.#table, { type: 'single', id }, [
      ...this.#stages,
    ])
  }

  toSpec(): QuerySpec {
    return {
      table: this.#table,
      mode: this.#mode,
      stages: this.#stages,
    }
  }
}

export type QueryStore<TSchema extends Schema> = {
  readonly [TTable in TableName<TSchema>]: TableQuery<TSchema, TTable>
} & {
  readonly table: <TTable extends TableName<TSchema>>(
    table: TTable,
  ) => TableQuery<TSchema, TTable>
}

export function createQueryStore<TSchema extends Schema>(
  schema: TSchema,
): QueryStore<TSchema>
export function createQueryStore(schema: Schema) {
  const table = (tableName: string) =>
    new TableQuery(schema, tableName)

  return new Proxy(
    { table },
    {
      get(target, property, receiver) {
        if (property in target) {
          return Reflect.get(target, property, receiver)
        }

        if (typeof property === 'string' && property in schema.tables) {
          return table(property)
        }

        return undefined
      },
    },
  )
}

export function query<TSchema extends Schema>(
  schema: TSchema,
): QueryStore<TSchema>
export function query(schema: Schema) {
  return createQueryStore(schema)
}

export type { AnyQuery }
