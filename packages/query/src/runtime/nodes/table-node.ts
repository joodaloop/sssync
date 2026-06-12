import type { TableSchema } from '@sssync/zero-schema'
import type { RowDelta, RuntimeRow } from '../types'
import type { RowTable } from '../row-table'
import { QueryNode } from './query-node'

export class TableNode extends QueryNode {
  constructor(id: string, table: TableSchema, source: RowTable<RuntimeRow>) {
    super({
      id,
      type: 'table',
      label: table.name,
      table: table.name,
      tableSchema: table,
      rowTable: source,
    })

    for (const id of source.ids()) {
      this.ids.add(id)
    }

    this.track(source.subscribe(change => this.apply(change)))
  }

  apply(change: RowDelta<RuntimeRow>) {
    if (change.type === 'delete') {
      this.ids.delete(change.id)
    } else {
      this.ids.add(change.id)
    }
    this.emit(change)
  }
}
