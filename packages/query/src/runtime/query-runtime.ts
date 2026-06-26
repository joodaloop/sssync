import type { Schema } from '@sssync/zero-schema'
import type { QuerySpec, RowFor, Scalar, TableName } from '../types'
import type { QuerySubscription, RowChange, RuntimeRow } from './types'
import { compilePipeline, QueryPipeline } from './nodes'
import { RowRelationshipsIndex } from './row-relationships-index'
import { RowTable, type RuntimeTables } from './row-table'

export class QueryRuntime<TSchema extends Schema> {
  readonly #schema: TSchema
  readonly #tables: RuntimeTables
  readonly #rowRelationships: RowRelationshipsIndex

  constructor(schema: TSchema) {
    this.#schema = schema
    this.#tables = createRuntimeTables(schema)
    this.#rowRelationships = new RowRelationshipsIndex(schema, this.#tables)
  }

  table<TTable extends TableName<TSchema>>(
    table: TTable,
  ): RowTable {
    return this.#tables[table]
  }

  add<TTable extends TableName<TSchema>>(
    table: TTable,
    row: RowFor<TSchema, TTable>,
  ): RowChange<RuntimeRow> {
    return this.#tables[table].add(row)
  }

  update<TTable extends TableName<TSchema>>(
    table: TTable,
    id: Scalar | readonly Scalar[],
    patch: Partial<RowFor<TSchema, TTable>>,
  ): RowChange<RuntimeRow> {
    return this.#tables[table].update(id, patch)
  }

  delete<TTable extends TableName<TSchema>>(
    table: TTable,
    id: Scalar | readonly Scalar[],
  ): RowChange<RuntimeRow> {
    return this.#tables[table].delete(id)
  }

  compile(spec: QuerySpec): QueryPipeline {
    return compilePipeline(this.#schema, this.#tables, this.#rowRelationships, spec)
  }

  materialize(spec: QuerySpec): readonly RuntimeRow[] {
    const pipeline = this.compile(spec)
    const rows = pipeline.rows()
    pipeline.dispose()
    return rows
  }

  subscribe(
    spec: QuerySpec,
    listener: (change: RowChange<RuntimeRow>) => void,
  ): QuerySubscription {
    const pipeline = this.compile(spec)
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

function createRuntimeTables(schema: Schema): RuntimeTables {
  const tables: Record<string, RowTable> = {}
  for (const [name, table] of Object.entries(schema.tables)) {
    tables[name] = new RowTable(table)
  }
  return tables
}
