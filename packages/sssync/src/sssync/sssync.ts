import * as v from 'valibot'
import type { TableSchemaMap } from '../schema/types'
import type { EventMap, EventArgs } from '../events/types'
import type { ProjectorMap, ProjectorResult } from '../projectors/types'
import type { LoaderMap } from '../loaders/types'
import type { Store } from '../store/types'

export interface Puller {
  connectToStream(streamId: string): void
}

export interface SSSyncConfig<
  Schema extends TableSchemaMap,
  Events extends EventMap,
  Projectors extends ProjectorMap<Schema, Events>,
  Loaders extends LoaderMap,
> {
  schema: Schema
  events: Events
  projectors: Projectors
  store: Store<Schema>
  loaders: Loaders
  puller?: Puller
}

export type CommitResult<S extends TableSchemaMap> =
  | { data: ProjectorResult<S>; err: null }
  | { data: null; err: Error }

export class SSSync<
  Schema extends TableSchemaMap,
  Events extends EventMap,
  Projectors extends ProjectorMap<Schema, Events>,
  Loaders extends LoaderMap,
> {
  readonly schema: Schema
  readonly events: Events
  readonly projectors: Projectors
  readonly store: Store<Schema>
  readonly loaders: Loaders
  readonly puller?: Puller

  constructor(config: SSSyncConfig<Schema, Events, Projectors, Loaders>) {
    this.schema = config.schema
    this.events = config.events
    this.projectors = config.projectors
    this.store = config.store
    this.loaders = config.loaders
    this.puller = config.puller
  }

  async commit<K extends keyof Events & string>(
    eventName: K,
    args: Events[K] extends v.GenericSchema ? EventArgs<Events[K]> : never,
  ): Promise<CommitResult<Schema>> {
    const eventSchema = this.events[eventName]
    if (!eventSchema) {
      return { data: null, err: new Error(`Unknown event: ${eventName}`) }
    }
    const projector = this.projectors[eventName]
    if (typeof projector !== 'function') {
      return { data: null, err: new Error(`No projector for event: ${eventName}`) }
    }

    const parsed = v.safeParse(eventSchema, args)
    if (!parsed.success) {
      return { data: null, err: new Error(`Invalid event args for ${eventName}`) }
    }

    try {
      const op = projector(parsed.output) as ProjectorResult<Schema>
      await this.store.apply(op)
      return { data: op, err: null }
    } catch (err) {
      return { data: null, err: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  metadata() {
    return {}
  }
}
