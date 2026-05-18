import type { TableSchemaMap } from '../schema/types'
import type { StoreOperationInput } from '../operations/types'

export interface Store<S extends TableSchemaMap> {
  apply(ops: StoreOperationInput<S>): void | Promise<void>
}
