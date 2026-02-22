# @sssync/solid-ivm

`@sssync/solid-ivm` is now a thin TanStack wrapper: local-only `Collection`s for writes, and `@tanstack/solid-db` for live query reads.

## What it provides

- A collection-first database wrapper with write helpers (`insert`, `upsert`, `update`, `delete`, `apply`, `replace`)
- `liveQuery()` delegated to `@tanstack/solid-db`'s `useLiveQuery`
- Local-only collections (`localOnlyCollectionOptions`) so direct `insert/update/delete` works without sync adapters
- Compatibility layer for wiring existing materializer pipelines into TanStack mutation APIs

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

// TanStack solid-db accessor
live();

// reactive map (key -> row)
live.state;

// query status
live.status;
```

## Query input options

`liveQuery()` accepts:

- A query callback: `(q) => q.from(...).where(...).select(...)`
- A built query builder instance

## Notes

- `replace()` is snapshot-style hydration for one or more collections.
- `apply()` supports batched actions: `insert | upsert | update | delete`.
- The prior custom IVM runtime is preserved in `src/old-implementation.ts` for future experimentation.
