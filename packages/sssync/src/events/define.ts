import type { EventName, EventSchema, NoTransformEventMap } from './types'

export function defineEvents<
  E extends Record<EventName, EventSchema>,
>(events: E & NoTransformEventMap<E>): E {
  return events
}
