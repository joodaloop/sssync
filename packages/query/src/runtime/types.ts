export type RowDelta<TRow = unknown> =
  | {
      readonly type: 'add'
      readonly table: string
      readonly id: string
      readonly row: TRow
    }
  | {
      readonly type: 'update'
      readonly table: string
      readonly id: string
      readonly old: TRow
      readonly row: TRow
    }
  | {
      readonly type: 'delete'
      readonly table: string
      readonly id: string
      readonly old: TRow
    }

export type RowChange<TRow = unknown> = RowDelta<TRow>

export type QuerySubscription<TRow> = {
  readonly rows: () => readonly TRow[]
  readonly nodes: () => readonly QueryNodeSnapshot[]
  readonly unsubscribe: () => void
}

export type QueryNodeSnapshot = {
  readonly id: string
  readonly type: 'table' | 'where' | 'related' | 'single'
  readonly label: string
  readonly table: string
  readonly rowCount: number
  readonly rowIds: readonly string[]
}

export type ChangeListener<TRow> = (change: RowDelta<TRow>) => void

export type RuntimeRow = Record<string, unknown>

export type EdgeChange =
  | {
      readonly type: 'add'
      readonly sourceKey: string
      readonly destId: string
      readonly row: RuntimeRow
    }
  | {
      readonly type: 'delete'
      readonly sourceKey: string
      readonly destId: string
      readonly old: RuntimeRow
    }
  | {
      readonly type: 'update'
      readonly sourceKey: string
      readonly destId: string
      readonly old: RuntimeRow
      readonly row: RuntimeRow
    }
  | {
      readonly type: 'move'
      readonly oldSourceKey: string
      readonly sourceKey: string
      readonly destId: string
      readonly old: RuntimeRow
      readonly row: RuntimeRow
    }

export type RelationshipTableChange = {
  readonly tableName: string
  readonly edgeIndex: number
  readonly change: EdgeChange
}
