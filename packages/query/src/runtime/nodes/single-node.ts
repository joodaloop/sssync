import type { TableSchema } from '@sssync/zero-schema'
import type { Scalar } from '../../types'
import type { RowDelta, RuntimeRow } from '../types'
import type { RowTable } from '../row-table'
import { primaryKeyToId } from '../utils'
import { QueryNode } from './query-node'

export class SingleNode extends QueryNode {
  readonly #targetId: string

  constructor(
    id: string,
    table: TableSchema,
    source: RowTable,
    targetId: Scalar | readonly Scalar[],
  ) {
    super({
      id,
      type: 'single',
      label: `${table.name}.single`,
      table: table.name,
      tableSchema: table,
      rowTable: source,
    })

    this.#targetId = primaryKeyToId(targetId)
    if (source.get(this.#targetId)) {
      this.ids.add(this.#targetId)
    }

    this.track(source.subscribe(change => this.apply(change)))
  }

  apply(change: RowDelta<RuntimeRow>) {
    if (change.id !== this.#targetId) {
      return
    }

    if (change.type === 'delete') {
      this.ids.delete(change.id)
    } else {
      this.ids.add(change.id)
    }
    this.emit(change)
  }
}
