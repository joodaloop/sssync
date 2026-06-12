import type { Relationship, Schema, TableSchema } from '@sssync/zero-schema'
import { evaluateWhere } from './expression'
import type { QuerySpec, RowFor, Scalar, TableName, WhereExpression } from './types'

export type RowChange<TRow = unknown> =
  | { readonly type: 'add'; readonly id: string; readonly row: TRow }
  | {
      readonly type: 'update'
      readonly id: string
      readonly old: TRow
      readonly row: TRow
    }
  | { readonly type: 'delete'; readonly id: string; readonly old: TRow }

export type QuerySubscription<TRow> = {
  readonly rows: () => readonly TRow[]
  readonly nodes: () => readonly QueryNodeSnapshot[]
  readonly unsubscribe: () => void
}

export type QueryNodeSnapshot = {
  readonly id: string
  readonly type: 'table' | 'where' | 'related'
  readonly label: string
  readonly table: string
  readonly rowCount: number
  readonly rowIds: readonly string[]
}

type ChangeListener<TRow> = (change: RowChange<TRow>) => void

type RuntimeRow = Record<string, unknown>

export class RowTable<TRow extends RuntimeRow> {
  readonly #schema: TableSchema
  readonly #rows = new Map<string, TRow>()
  readonly #indexes = new Map<string, Map<string, Set<string>>>()
  readonly #listeners = new Set<ChangeListener<TRow>>()

  constructor(schema: TableSchema) {
    this.#schema = schema
  }

  add(row: TRow): RowChange<TRow> {
    const id = rowId(this.#schema, row)
    if (this.#rows.has(id)) {
      throw new Error(`Row "${this.#schema.name}:${id}" already exists`)
    }

    this.#rows.set(id, row)
    this.#addToIndexes(id, row)
    const change = { type: 'add', id, row } as const
    this.#emit(change)
    return change
  }

  update(id: Scalar | readonly Scalar[], patch: Partial<TRow>): RowChange<TRow> {
    const key = primaryKeyToId(id)
    const old = this.#rows.get(key)
    if (!old) {
      throw new Error(`Row "${this.#schema.name}:${key}" does not exist`)
    }

    const row = { ...old, ...patch } as TRow
    const nextKey = rowId(this.#schema, row)
    if (nextKey !== key) {
      throw new Error('Updating primary key fields is not supported')
    }

    this.#rows.set(key, row)
    this.#removeFromIndexes(key, old)
    this.#addToIndexes(key, row)
    const change = { type: 'update', id: key, old, row } as const
    this.#emit(change)
    return change
  }

  delete(id: Scalar | readonly Scalar[]): RowChange<TRow> {
    const key = primaryKeyToId(id)
    const old = this.#rows.get(key)
    if (!old) {
      throw new Error(`Row "${this.#schema.name}:${key}" does not exist`)
    }

    this.#rows.delete(key)
    this.#removeFromIndexes(key, old)
    const change = { type: 'delete', id: key, old } as const
    this.#emit(change)
    return change
  }

  get(id: Scalar | readonly Scalar[]): TRow | undefined {
    return this.#rows.get(primaryKeyToId(id))
  }

  rows(): readonly TRow[] {
    return [...this.#rows.values()]
  }

  rowsByFields(fields: readonly string[], values: readonly unknown[]): readonly TRow[] {
    const index = this.#indexFor(fields)
    const ids = index.get(indexValue(values))
    if (!ids) {
      return []
    }

    return [...ids]
      .map(id => this.#rows.get(id))
      .filter((row): row is TRow => row !== undefined)
  }

  subscribe(listener: ChangeListener<TRow>): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #emit(change: RowChange<TRow>) {
    for (const listener of this.#listeners) {
      listener(change)
    }
  }

  #indexFor(fields: readonly string[]): Map<string, Set<string>> {
    const key = indexKey(fields)
    let index = this.#indexes.get(key)
    if (index) {
      return index
    }

    index = new Map()
    for (const [id, row] of this.#rows) {
      addIndexEntry(index, indexValue(fields.map(field => row[field])), id)
    }
    this.#indexes.set(key, index)
    return index
  }

  #addToIndexes(id: string, row: TRow) {
    for (const [fieldsKey, index] of this.#indexes) {
      const fields = fieldsKey.split('\0')
      addIndexEntry(index, indexValue(fields.map(field => row[field])), id)
    }
  }

  #removeFromIndexes(id: string, row: TRow) {
    for (const [fieldsKey, index] of this.#indexes) {
      const fields = fieldsKey.split('\0')
      const key = indexValue(fields.map(field => row[field]))
      const ids = index.get(key)
      ids?.delete(id)
      if (ids?.size === 0) {
        index.delete(key)
      }
    }
  }
}

export type RuntimeTables<TSchema extends Schema> = {
  readonly [TTable in TableName<TSchema>]: RowTable<RowFor<TSchema, TTable>>
}

abstract class QueryNode<TRow extends RuntimeRow> {
  readonly id: string
  readonly type: QueryNodeSnapshot['type']
  readonly label: string
  readonly table: string
  protected readonly tableSchema: TableSchema
  protected rowsById = new Map<string, TRow>()
  readonly #listeners = new Set<ChangeListener<TRow>>()
  readonly #unsubscribes: (() => void)[] = []

  constructor(options: {
    readonly id: string
    readonly type: QueryNodeSnapshot['type']
    readonly label: string
    readonly table: string
    readonly tableSchema: TableSchema
  }) {
    this.id = options.id
    this.type = options.type
    this.label = options.label
    this.table = options.table
    this.tableSchema = options.tableSchema
  }

  rows(): readonly TRow[] {
    return [...this.rowsById.values()]
  }

  subscribe(listener: ChangeListener<TRow>): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  snapshot(): QueryNodeSnapshot {
    return {
      id: this.id,
      type: this.type,
      label: this.label,
      table: this.table,
      rowCount: this.rowsById.size,
      rowIds: [...this.rowsById.keys()],
    }
  }

  dispose() {
    for (const unsubscribe of this.#unsubscribes) {
      unsubscribe()
    }
    this.#unsubscribes.length = 0
    this.#listeners.clear()
  }

  protected track(unsubscribe: () => void) {
    this.#unsubscribes.push(unsubscribe)
  }

  protected emit(change: RowChange<TRow>) {
    for (const listener of this.#listeners) {
      listener(change)
    }
  }

  protected replaceRows(nextRows: readonly TRow[]) {
    const nextById = new Map(nextRows.map(row => [rowId(this.tableSchema, row), row]))
    const previous = this.rowsById
    this.rowsById = nextById

    for (const [id, old] of previous) {
      if (!nextById.has(id)) {
        this.emit({ type: 'delete', id, old })
      }
    }

    for (const [id, row] of nextById) {
      const old = previous.get(id)
      if (!old) {
        this.emit({ type: 'add', id, row })
      } else if (old !== row) {
        this.emit({ type: 'update', id, old, row })
      }
    }
  }
}

class TableNode<TRow extends RuntimeRow> extends QueryNode<TRow> {
  constructor(id: string, table: TableSchema, source: RowTable<TRow>, mode: QuerySpec['mode']) {
    super({
      id,
      type: 'table',
      label: mode.type === 'single' ? `${table.name}.single` : table.name,
      table: table.name,
      tableSchema: table,
    })

    const initial =
      mode.type === 'single'
        ? source.get(mode.id)
          ? [source.get(mode.id) as TRow]
          : []
        : source.rows()
    this.rowsById = new Map(initial.map(row => [rowId(table, row), row]))

    this.track(
      source.subscribe(change => {
        if (mode.type === 'single' && change.id !== primaryKeyToId(mode.id)) {
          return
        }
        this.apply(change)
      }),
    )
  }

  apply(change: RowChange<TRow>) {
    if (change.type === 'add') {
      this.rowsById.set(change.id, change.row)
    } else if (change.type === 'update') {
      this.rowsById.set(change.id, change.row)
    } else {
      this.rowsById.delete(change.id)
    }
    this.emit(change)
  }
}

class WhereNode<TRow extends RuntimeRow> extends QueryNode<TRow> {
  readonly #input: QueryNode<TRow>
  readonly #expression: WhereExpression

  constructor(
    id: string,
    input: QueryNode<TRow>,
    expression: WhereExpression,
  ) {
    super({
      id,
      type: 'where',
      label: 'where',
      table: input.table,
      tableSchema: input.tableSchema,
    })
    this.#input = input
    this.#expression = expression
    this.rowsById = new Map(
      input
        .rows()
        .filter(row => evaluateWhere(expression, row))
        .map(row => [rowId(this.tableSchema, row), row]),
    )
    this.track(input.subscribe(change => this.apply(change)))
  }

  apply(change: RowChange<TRow>) {
    if (change.type === 'add') {
      if (!evaluateWhere(this.#expression, change.row)) {
        return
      }
      this.rowsById.set(change.id, change.row)
      this.emit(change)
      return
    }

    if (change.type === 'delete') {
      if (!this.rowsById.has(change.id)) {
        return
      }
      this.rowsById.delete(change.id)
      this.emit(change)
      return
    }

    const wasIn = this.rowsById.has(change.id)
    const isIn = evaluateWhere(this.#expression, change.row)

    if (!wasIn && isIn) {
      this.rowsById.set(change.id, change.row)
      this.emit({ type: 'add', id: change.id, row: change.row })
    } else if (wasIn && !isIn) {
      this.rowsById.delete(change.id)
      this.emit({ type: 'delete', id: change.id, old: change.old })
    } else if (wasIn && isIn) {
      this.rowsById.set(change.id, change.row)
      this.emit(change)
    }
  }
}

class RelatedNode extends QueryNode<RuntimeRow> {
  readonly #schema: Schema
  readonly #input: QueryNode<RuntimeRow>
  readonly #tables: Record<string, RowTable<RuntimeRow>>
  readonly #sourceTable: string
  readonly #relationship: Relationship

  constructor(options: {
    readonly id: string
    readonly schema: Schema
    readonly input: QueryNode<RuntimeRow>
    readonly tables: Record<string, RowTable<RuntimeRow>>
    readonly sourceTable: string
    readonly targetTable: string
    readonly relationshipName: string
    readonly relationship: Relationship
  }) {
    super({
      id: options.id,
      type: 'related',
      label: `related(${options.relationshipName})`,
      table: options.targetTable,
      tableSchema: options.schema.tables[options.targetTable],
    })
    this.#schema = options.schema
    this.#input = options.input
    this.#tables = options.tables
    this.#sourceTable = options.sourceTable
    this.#relationship = options.relationship

    this.rowsById = new Map(
      this.computeRows().map(row => [rowId(this.tableSchema, row), row]),
    )
    this.track(options.input.subscribe(() => this.replaceRows(this.computeRows())))

    for (const table of relationshipTables(options.relationship)) {
      this.track(options.tables[table].subscribe(() => this.replaceRows(this.computeRows())))
    }
  }

  computeRows(): RuntimeRow[] {
    return followRelationship(
      this.#schema,
      this.#tables,
      this.#input.rows(),
      this.#sourceTable,
      this.#relationship,
    )
  }
}

export class QueryPipeline<TRow = unknown> {
  readonly #nodes: QueryNode<RuntimeRow>[]

  constructor(nodes: QueryNode<RuntimeRow>[]) {
    this.#nodes = nodes
  }

  output(): QueryNode<RuntimeRow> {
    return this.#nodes[this.#nodes.length - 1]
  }

  rows(): readonly TRow[] {
    return this.output().rows() as TRow[]
  }

  nodes(): readonly QueryNodeSnapshot[] {
    return this.#nodes.map(node => node.snapshot())
  }

  subscribe(listener: ChangeListener<TRow>): () => void {
    return this.output().subscribe(listener as ChangeListener<RuntimeRow>)
  }

  dispose() {
    for (const node of this.#nodes) {
      node.dispose()
    }
  }
}

export class QueryRuntime<TSchema extends Schema> {
  readonly #schema: TSchema
  readonly #tables: RuntimeTables<TSchema>

  constructor(schema: TSchema) {
    this.#schema = schema
    this.#tables = Object.fromEntries(
      Object.entries(schema.tables).map(([name, table]) => [
        name,
        new RowTable(table),
      ]),
    ) as RuntimeTables<TSchema>
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
    return compilePipeline(this.#schema, this.#tables, spec)
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

function compilePipeline<TRow>(
  schema: Schema,
  tables: Record<string, RowTable<RuntimeRow>>,
  spec: QuerySpec,
): QueryPipeline<TRow> {
  const root = rootTableFor(spec)
  const nodes: QueryNode<RuntimeRow>[] = [
    new TableNode('node:0', schema.tables[root], tables[root], spec.mode),
  ]
  let current = nodes[0]

  spec.stages.forEach((stage, index) => {
    if (stage.type === 'where') {
      current = new WhereNode(`node:${index + 1}`, current, stage.expression)
    } else {
      current = new RelatedNode({
        id: `node:${index + 1}`,
        schema,
        input: current,
        tables,
        sourceTable: stage.sourceTable,
        targetTable: stage.targetTable,
        relationshipName: stage.name,
        relationship: stage.relationship,
      })
    }
    nodes.push(current)
  })

  return new QueryPipeline<TRow>(nodes)
}

function followRelationship(
  schema: Schema,
  tables: Record<string, RowTable<RuntimeRow>>,
  rows: readonly RuntimeRow[],
  sourceTable: string,
  relationship: Relationship,
): RuntimeRow[] {
  let currentRows = [...rows]
  let currentTable = sourceTable

  for (const connection of relationship) {
    const destTable = schema.tables[connection.destSchema]
    const destRows = tables[connection.destSchema].rows()
    const next: RuntimeRow[] = []

    for (const source of currentRows) {
      const values = connection.sourceField.map(field => source[field])
      next.push(...tables[connection.destSchema].rowsByFields(connection.destField, values))
    }

    currentRows = dedupeRows(destTable, next)
    currentTable = connection.destSchema
  }

  return dedupeRows(schema.tables[currentTable], currentRows)
}

function dedupeRows(table: TableSchema, rows: readonly RuntimeRow[]): RuntimeRow[] {
  const byId = new Map<string, RuntimeRow>()
  for (const row of rows) {
    byId.set(rowId(table, row), row)
  }
  return [...byId.values()]
}

function rowId(table: TableSchema, row: RuntimeRow): string {
  return primaryKeyToId(table.primaryKey.map(key => row[key] as Scalar))
}

function primaryKeyToId(id: Scalar | readonly Scalar[]): string {
  return Array.isArray(id) ? id.map(String).join('\0') : String(id)
}

function indexKey(fields: readonly string[]): string {
  return fields.join('\0')
}

function indexValue(values: readonly unknown[]): string {
  return values.map(value => JSON.stringify(value)).join('\0')
}

function addIndexEntry(index: Map<string, Set<string>>, key: string, id: string) {
  let ids = index.get(key)
  if (!ids) {
    ids = new Set()
    index.set(key, ids)
  }
  ids.add(id)
}

function rootTableFor(spec: QuerySpec): string {
  return spec.stages.find(stage => stage.type === 'related')?.sourceTable ?? spec.table
}

function relationshipTables(relationship: Relationship): string[] {
  return [...new Set(relationship.map(connection => connection.destSchema))]
}
