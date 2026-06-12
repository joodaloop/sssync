import { evaluateWhere } from '../../expression'
import type { WhereExpression } from '../../types'
import type { RowDelta, RuntimeRow } from '../types'
import { QueryNode } from './query-node'

export class WhereNode extends QueryNode {
  readonly #expression: WhereExpression

  constructor(
    id: string,
    input: QueryNode,
    expression: WhereExpression,
  ) {
    super({
      id,
      type: 'where',
      label: 'where',
      table: input.table,
      tableSchema: input.tableSchema,
      rowTable: input.rowTable,
    })
    this.#expression = expression

    for (const row of input.rows()) {
      if (evaluateWhere(expression, row)) {
        this.ids.add(this.idFor(row))
      }
    }

    this.track(input.subscribe(change => this.apply(change)))
  }

  apply(change: RowDelta<RuntimeRow>) {
    if (change.type === 'add') {
      if (!evaluateWhere(this.#expression, change.row)) {
        return
      }
      this.ids.add(change.id)
      this.emit(change)
      return
    }

    if (change.type === 'delete') {
      if (!this.ids.delete(change.id)) {
        return
      }
      this.emit(change)
      return
    }

    const wasIn = this.ids.has(change.id)
    const isIn = evaluateWhere(this.#expression, change.row)

    if (!wasIn && isIn) {
      this.ids.add(change.id)
      this.emit({
        type: 'add',
        table: change.table,
        id: change.id,
        row: change.row,
      })
    } else if (wasIn && !isIn) {
      this.ids.delete(change.id)
      this.emit({
        type: 'delete',
        table: change.table,
        id: change.id,
        old: change.old,
      })
    } else if (wasIn && isIn) {
      this.emit(change)
    }
  }
}
