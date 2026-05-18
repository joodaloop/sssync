import type { ProjectorMap } from '../projectors/types'
import type { MockEvents } from './mock-events'
import type { MockSchema } from './mock-schema'

export const mockProjectors: ProjectorMap<MockSchema, MockEvents> = {
  v1_postAdded: ({ id, content }) => [
    { type: 'add', table: 'posts', data: { id, content, title: 'Untitled' } },
  ],
  v2_postAdded: ({ id, content, title }) => [
    { type: 'add', table: 'posts', data: { id, content, title } },
  ],
  v1_userAdded: ({ id, name }) => [
    { type: 'add', table: 'users', data: { id, name } },
  ],
}
