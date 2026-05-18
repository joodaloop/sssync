import type { EventMap } from '../events/types'
import type { ProjectorMap } from './types'

type NoExtraProjectors<
  Events extends EventMap,
  Projectors,
> = Projectors & Record<Exclude<keyof Projectors, keyof Events>, never>

export function defineProjectors<const Events extends EventMap>() {
  return <const Projectors extends ProjectorMap<Events>>(
    projectors: NoExtraProjectors<Events, Projectors>,
  ): Projectors => projectors
}
