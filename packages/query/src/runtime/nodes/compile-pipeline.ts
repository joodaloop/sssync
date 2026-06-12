import type { Schema } from '@sssync/zero-schema'
import type { QuerySpec } from '../../types'
import type { RuntimeRow } from '../types'
import type { RowRelationshipsIndex } from '../row-relationships-index'
import type { RowTable } from '../row-table'
import { rootTableFor } from '../utils'
import { QueryNode } from './query-node'
import { QueryPipeline } from './query-pipeline'
import { RelatedNode } from './related-node'
import { SingleNode } from './single-node'
import { TableNode } from './table-node'
import { WhereNode } from './where-node'

export function compilePipeline<TRow>(
  schema: Schema,
  tables: Record<string, RowTable<RuntimeRow>>,
  rowRelationships: RowRelationshipsIndex,
  spec: QuerySpec,
): QueryPipeline<TRow> {
  const root = rootTableFor(spec)
  const rootTable = schema.tables[root]
  const rootRows = tables[root]
  const nodes: QueryNode[] = [
    spec.mode.type === 'single'
      ? new SingleNode('node:0', rootTable, rootRows, spec.mode.id)
      : new TableNode('node:0', rootTable, rootRows),
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
        rowRelationships,
        targetRows: tables[stage.targetTable],
        sourceTable: stage.sourceTable,
        targetTable: stage.targetTable,
        relationshipName: stage.name,
      })
    }
    nodes.push(current)
  })

  return new QueryPipeline<TRow>(nodes)
}
