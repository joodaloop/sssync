import * as v from 'valibot'
import { defineEvents } from '../src/events/define'
import type { ActiveEventName, EventArgs } from '../src/events/types'

const events = defineEvents({
  PostCreated_v1: {
    name: 'PostCreated_v1',
    data: v.object({
      id: v.string(),
      title: v.string(),
    }),
  },
  PostCreated_v2: {
    name: 'PostCreated_v2',
    data: v.object({
      id: v.string(),
      title: v.string(),
      description: v.string(),
    }),
    deprecated: true,
  },
})

type PostCreatedV1 = EventArgs<typeof events.PostCreated_v1>

const validData: PostCreatedV1 = {
  id: 'post_1',
  title: 'Hello',
}

validData

// @ts-expect-error missing title
const missingTitle: PostCreatedV1 = {
  id: 'post_1',
}

missingTitle

const wrongID: PostCreatedV1 = {
  // @ts-expect-error id must be a string
  id: 123,
  title: 'Hello',
}

wrongID

defineEvents({
  // @ts-expect-error event names must end in _vN
  PostCreated: {
    name: 'PostCreated',
    data: v.object({ id: v.string() }),
  },
})

defineEvents({
  PostCreated_v1: {
    // @ts-expect-error name must match key
    name: 'PostRenamed_v1',
    // @ts-expect-error name must match key
    data: v.object({ id: v.string() }),
  },
})

type ActiveNames = ActiveEventName<typeof events>

const activeName: ActiveNames = 'PostCreated_v1'

activeName

// @ts-expect-error deprecated events are not active
const deprecatedName: ActiveNames = 'PostCreated_v2'

deprecatedName
