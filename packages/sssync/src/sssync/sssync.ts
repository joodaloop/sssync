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

export type CommitApi<
  S extends TableSchemaMap,
  Events extends EventMap,
> = {
  [K in keyof Events]: Events[K] extends v.GenericSchema
    ? (args: EventArgs<Events[K]>) => Promise<CommitResult<S>>
    : never
}

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
  readonly commit: CommitApi<Schema, Events>

  constructor(config: SSSyncConfig<Schema, Events, Projectors, Loaders>) {
    this.schema = config.schema
    this.events = config.events
    this.projectors = config.projectors
    this.store = config.store
    this.loaders = config.loaders
    this.puller = config.puller

    this.commit = new Proxy({} as CommitApi<Schema, Events>, {
      get: (_, eventName: string) => {
        return (args: unknown) => this.#commit(eventName, args)
      },
    })
  }

  async #commit(eventName: string, args: unknown): Promise<CommitResult<Schema>> {
    const eventSchema = (this.events as Record<string, v.GenericSchema>)[eventName]
    if (!eventSchema) {
      return { data: null, err: new Error(`Unknown event: ${eventName}`) }
    }
    const projector = (this.projectors as Record<string, unknown>)[eventName]
    if (typeof projector !== 'function') {
      return { data: null, err: new Error(`No projector for event: ${eventName}`) }
    }

    const parsed = v.safeParse(eventSchema, args)
    if (!parsed.success) {
      return { data: null, err: new Error(`Invalid event args for ${eventName}`) }
    }

    try {
      const op = (projector as (a: unknown) => ProjectorResult<Schema>)(parsed.output)
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
