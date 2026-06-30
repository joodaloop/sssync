import { column, createSchema, table } from '../src/schema'
import { Store } from '../src/store'

const issues = table('issues')
  .columns({
    id: column.string(),
    title: column.string(),
    priority: column.number(),
    done: column.boolean(),
  })
  .primaryKey('id')

const schema = createSchema({ tables: [issues] })
const store = new Store(schema)

store.addIfNotExist({
  issues: [{ id: '1', title: 'First', priority: 1, done: false }],
})

// @ts-expect-error table names come from the schema
store.addIfNotExist({ issuez: [] })

store.addIfNotExist({
  issues: [
    {
      id: '1',
      title: 'First',
      // @ts-expect-error row shapes come from the schema
      priority: 'high',
      done: false,
    },
  ],
})
