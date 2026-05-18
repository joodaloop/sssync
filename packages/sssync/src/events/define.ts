import type { EventMap, EventName } from './types'
import type * as v from 'valibot'

export function defineEvents<
  E extends Record<EventName, v.GenericSchema>,
>(events: E): E {
  return events
}
