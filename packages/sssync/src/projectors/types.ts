import type * as v from 'valibot'
import type { EventArgs, EventMap } from '../events/types'
import type { TableSchemaMap } from '../schema/types'
import type { StoreOperationInput } from '../operations/types'

export type {
  StoreOperation,
  StoreOperationAdd,
  StoreOperationInput,
  StoreOperationRemove,
  StoreOperationUpdate,
} from '../operations/types'

export type ProjectorResult<S extends TableSchemaMap> = StoreOperationInput<S>

export type ProjectorMap<
  S extends TableSchemaMap,
  Events extends EventMap,
> = {
  [K in keyof Events]: Events[K] extends v.GenericSchema
    ? (args: EventArgs<Events[K]>) => ProjectorResult<S>
    : never
}
