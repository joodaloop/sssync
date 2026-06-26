import type { StandardSchemaV1 } from '../types'
import type { EventDefinition, EventName, JSONValue } from './types'

type AnyEvent = EventDefinition<
  EventName,
  StandardSchemaV1<unknown, JSONValue>,
  boolean | undefined
>

type NamesMustMatchKeys<Events extends Record<string, AnyEvent>> = {
  [Key in keyof Events]: Key extends EventName
    ? Events[Key] & { name: Key }
    : never
}

export function defineEvents<const Events extends Record<string, AnyEvent>>(
  events: Events & NamesMustMatchKeys<Events>,
): Events {
  return events
}
