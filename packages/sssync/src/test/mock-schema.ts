import { column, table } from '../schema/define'

const posts = table('posts')
  .columns({
    id: column.string(),
    content: column.string(),
    title: column.string(),
  })
  .primaryKey('id')
  .build()

const users = table('users')
  .columns({
    id: column.string(),
    name: column.string(),
    bio: column.string().optional(),
  })
  .primaryKey('id')
  .build()

export const mockSchema = {
  posts,
  users,
} as const

export type MockSchema = typeof mockSchema
