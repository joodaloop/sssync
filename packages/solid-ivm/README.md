# @sssync/solid-ivm

`@sssync/solid-ivm` keeps TanStack DB `Collection`s as the write/read layer and projects query results into granular Solid stores via IVM.

## What it provides

- A collection-first database wrapper with write helpers (`insert`, `upsert`, `update`, `delete`, `apply`, `replace`)
- `liveQuery()` that compiles TanStack query IR into a D2 graph
- `subscribeChanges()` → MultiSet conversion → incremental Solid store updates
- Keyed reactive query output (`records`) plus stable row order (`order`)

## API

```ts
import {
  createSolidIvmCollections,
  createSolidIvmDatabase,
} from "@sssync/solid-ivm";

const collections = createSolidIvmCollections({
  todos: {
    getKey: (todo: { id: string; title: string; done: boolean }) => todo.id,
  },
});

const db = createSolidIvmDatabase({ collections });

db.insert("todos", { id: "1", title: "Ship IVM", done: false });
db.update("todos", "1", { done: true });

const live = db.liveQuery((q) =>
  q
    .from({ todo: collections.todos })
    .select(({ todo }) => ({
      id: todo.id,
      title: todo.title,
      done: todo.done,
    }))
    .orderBy(({ todo }) => todo.title, "asc"),
);

// keyed store
live.data.records;

// ordered array accessor
live.rows();

// cleanup
live.dispose();
```

## Query input options

`liveQuery()` accepts:

- A query callback: `(q) => q.from(...).where(...).select(...)`
- A built query builder instance
- Query IR

## Notes

- `replace()` is snapshot-style hydration for one or more collections.
- `apply()` supports batched actions: `insert | upsert | update | delete`.
- For ordered queries, output order is maintained from TanStack's fractional index tokens.
