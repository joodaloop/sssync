import type { StandardSchemaV1 } from '../types'
import type { JSONValue } from '../shared'

export type { JSONValue } from '../shared'

export type EventName = `${string}_v${number}`

export interface EventDefinition<
  Name extends EventName = EventName,
  Data extends StandardSchemaV1<unknown, JSONValue> = StandardSchemaV1<
    unknown,
    JSONValue
  >,
  Deprecated extends boolean | undefined = boolean | undefined,
> {
  name: Name
  data: Data
  deprecated?: Deprecated
}

export type EventSchema<E extends EventDefinition = EventDefinition> = E['data']

export type EventData<E extends EventDefinition> =
  StandardSchemaV1.InferOutput<EventSchema<E>>

export type EventArgs<E extends EventDefinition> = EventData<E>

export type ActiveEventName<Events extends Record<string, EventDefinition>> = {
  [K in keyof Events]: Events[K] extends { deprecated: true } ? never : K
}[keyof Events] &
  string
