import * as v from 'valibot'
import type { TableSchemaMap } from '../schema/types'
import type { EventMap, EventArgs, NoTransformEventMap } from '../events/types'
import type { ProjectorMap, ProjectorResult } from '../projectors/types'
import type { LoaderMap } from '../loaders/types'
import type { Store } from '../store/types'
import { LeaderElection } from './leader-election'
import { listenChannel, type ChannelListener } from './listen-channel'

export interface Puller {
  connectToStream(streamId: string): void
}

export interface SSSyncConfig<
  Schema extends TableSchemaMap,
  Events extends EventMap,
  Loaders extends LoaderMap,
> {
  id: string
  schema: Schema
  store: Store<Schema>
  events: Events & NoTransformEventMap<Events>
  projectors: ProjectorMap<Schema, Events>
  loaders: Loaders
  puller?: Puller
}

export type CommitResult<S extends TableSchemaMap> =
  | { data: ProjectorResult<S>; err: null }
  | { data: null; err: Error }

export class SSSync<
  Schema extends TableSchemaMap,
  Events extends EventMap,
  Loaders extends LoaderMap,
> {
  readonly id: string
  readonly schema: Schema
  readonly events: Events
  readonly projectors: ProjectorMap<Schema, Events>
  readonly store: Store<Schema>
  readonly loaders: Loaders
  readonly puller?: Puller
  readonly leaderElection: LeaderElection
  pendingMutations: [] = []
  confirmedMutations: [] = []
  pullerQueue: [] = []


  constructor(config: SSSyncConfig<Schema, Events, Loaders>) {
    this.id = config.id
    this.schema = config.schema
    this.events = config.events
    this.projectors = config.projectors
    this.store = config.store
    this.loaders = config.loaders
    this.puller = config.puller
    this.leaderElection = new LeaderElection(`sssync-leader:${config.id}`)
    listenChannel(this.id, 'loaders', v.number()).handle((message) => {
      if (this.leaderElection.isLeader()) {
        console.log(message)
      }
    })
    listenChannel(this.id, 'puller', v.number()).handle((message) => {
      console.log(message)
    })
    listenChannel(this.id, 'rescan', v.array(v.string())).handle((message) => {
      console.log(message)
    })
  }

  isLeader(): boolean {
    return this.leaderElection.isLeader()
  }

  listenChannel<S extends v.GenericSchema>(
    name: string,
    schema: S,
  ): ChannelListener<S> {
    return listenChannel(this.id, name, schema)
  }

  commit<K extends keyof Events & string>(
    eventName: K,
    args: EventArgs<Events[K]>,
  ): CommitResult<Schema> {
    const eventSchema = this.events[eventName]
    if (!eventSchema) {
      return { data: null, err: new Error(`Unknown event: ${eventName}`) }
    }

    const parsed = v.safeParse(eventSchema, args)
    if (!parsed.success) {
      return { data: null, err: new Error(`Invalid event args for ${eventName}`) }
    }

    const projector = this.projectors[eventName]
    try {
      const op = projector(parsed.output)
      this.store.apply(op)
      return { data: op, err: null }
    } catch (err) {
      return {
        data: null,
        err: err instanceof Error ? err : new Error(String(err), { cause: err }),
      }
    }
  }


  metadata() {
    return {}
  }
}
