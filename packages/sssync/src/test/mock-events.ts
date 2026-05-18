import * as v from 'valibot'
import { defineEvents } from '../events/define'

export const mockEvents = defineEvents({
  v1_postAdded: v.object({
    id: v.string(),
    content: v.string(),
  }),
  v2_postAdded: v.object({
    id: v.string(),
    content: v.string(),
    title: v.string(),
  }),
  v1_userAdded: v.object({
    id: v.string(),
    name: v.string(),
  }),
})

export type MockEvents = typeof mockEvents
