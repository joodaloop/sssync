import type { Schema } from '@sssync/zero-schema'
import type { QuerySpec, RowFor, Scalar, TableName } from '../types'
import type { QuerySubscription, RowChange, RuntimeRow } from './types'
import { compilePipeline, QueryPipeline } from './nodes'
import { RowRelationshipsIndex } from './row-relationships-index'
import { RowTable, type RuntimeTables } from './row-table'

export class QueryRuntime<TSchema extends Schema> {
  readonly #schema: TSchema
  readonly #tables: RuntimeTables<TSchema>
  readonly #rowRelationships: RowRelationshipsIndex

  constructor(schema: TSchema) {
    this.#schema = schema
    this.#tables = Object.fromEntries(
      Object.entries(schema.tables).map(([name, table]) => [
        name,
        new RowTable(table),
      ]),
    ) as RuntimeTables<TSchema>
    this.#rowRelationships = new RowRelationshipsIndex(
      schema,
      this.#tables as Record<string, RowTable<RuntimeRow>>,
    )
  }

  table<TTable extends TableName<TSchema>>(
    table: TTable,
  ): RowTable<RowFor<TSchema, TTable>> {
    return this.#tables[table]
  }

  add<TTable extends TableName<TSchema>>(
    table: TTable,
    row: RowFor<TSchema, TTable>,
  ): RowChange<RowFor<TSchema, TTable>> {
    return this.#tables[table].add(row)
  }

  update<TTable extends TableName<TSchema>>(
    table: TTable,
    id: Scalar | readonly Scalar[],
    patch: Partial<RowFor<TSchema, TTable>>,
  ): RowChange<RowFor<TSchema, TTable>> {
    return this.#tables[table].update(id, patch)
  }

  delete<TTable extends TableName<TSchema>>(
    table: TTable,
    id: Scalar | readonly Scalar[],
  ): RowChange<RowFor<TSchema, TTable>> {
    return this.#tables[table].delete(id)
  }

  compile<TRow = unknown>(spec: QuerySpec): QueryPipeline<TRow> {
    return compilePipeline(this.#schema, this.#tables, this.#rowRelationships, spec)
  }

  materialize<TRow = unknown>(spec: QuerySpec): readonly TRow[] {
    const pipeline = this.compile<TRow>(spec)
    const rows = pipeline.rows()
    pipeline.dispose()
    return rows
  }

  subscribe<TRow>(
    spec: QuerySpec,
    listener: (change: RowChange<TRow>) => void,
  ): QuerySubscription<TRow> {
    const pipeline = this.compile<TRow>(spec)
    const unsubscribe = pipeline.subscribe(listener)

    return {
      rows: () => pipeline.rows(),
      nodes: () => pipeline.nodes(),
      unsubscribe: () => {
        unsubscribe()
        pipeline.dispose()
      },
    }
  }
}

export function createQueryRuntime<TSchema extends Schema>(
  schema: TSchema,
): QueryRuntime<TSchema> {
  return new QueryRuntime(schema)
}
