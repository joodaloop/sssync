# Plan: TanStack DB Query/IVM → Solid Stores

## Goal

Use TanStack DB's `Collection` as the data container and its query/IVM pipeline to incrementally maintain query results, but output to **Solid stores** instead of re-rendering flat arrays. This gives us granular reactivity — when one row in a 1000-row query result changes, only that row's DOM updates.

## What we're taking from TanStack DB

### Packages needed

1. **`@tanstack/db-ivm`** — the Differential Dataflow engine (D2 graph, operators, MultiSet)
   - Zero external deps besides `fractional-indexing` and `sorted-btree`
   - Completely standalone

2. **`@tanstack/db`** — specifically:
   - `createCollection` — data container with change tracking
   - `subscribeChanges` — emits `{type, key, value, previousValue}` change messages
   - Query builder (`from`, `where`, `join`, `select`, `orderBy`, etc.)
   - Query IR — the intermediate representation
   - `compileQuery` — compiles QueryIR → D2 pipeline
   - Expression functions (`eq`, `gt`, `and`, `or`, etc.)

### What we're NOT using

- `createLiveQueryCollection` — this is the glue that outputs query results back into a Collection. We replace this.
- `CollectionConfigBuilder` — the 1100-line orchestrator. We write our own ~100-line version.
- `CollectionSubscriber` — the subscription→D2 feeder. We write a simpler version.
- Any sync provider packages (electric, powersync, etc.)
- `@tanstack/pacer-lite` — only used for mutation pacing, not needed for queries

## How Collection works (what we're using)

```ts
import { createCollection } from '@tanstack/db'

const todos = createCollection<Todo, string>({
  id: 'todos',
  getKey: (todo) => todo.id,
  sync: { sync: () => {} },  // sync is required, can be a no-op
})
```

Collection requires a `sync` config — even a no-op `{ sync: () => {} }` works. Data gets into it via the sync callback's `write()` method, or via `collection.insert()` / `collection.update()` / `collection.delete()`.

### subscribeChanges

```ts
const subscription = collection.subscribeChanges(
  (changes: ChangeMessage[]) => {
    // changes = [{ type: 'insert'|'update'|'delete', key, value, previousValue? }]
  },
  {
    includeInitialState: true,  // emit current data as inserts
    whereExpression: ...,       // optional pre-compiled filter
  }
)
```

This is the hook we use to feed data into the D2 graph.

## How `compileQuery` works (what we're calling)

```ts
import { compileQuery } from '@tanstack/db'
import { D2, output } from '@tanstack/db-ivm'

const graph = new D2()
const input = graph.newInput()

const result = compileQuery(
  queryIR,                    // from buildQuery()
  { alias: input },           // D2 inputs per source alias
  { collectionId: collection }, // Collection instances (for index hints)
  {},                         // subscriptions (can be empty initially)
  {},                         // lazy source callbacks (empty for basic use)
  new Set(),                  // lazy sources set (empty)
  {},                         // orderBy optimization info (empty)
  () => {},                   // setWindowFn (no-op for basic use)
)

// result.pipeline is the compiled D2 stream
// result.sourceWhereClauses has per-alias WHERE for optimized subscriptions
```

Most of compileQuery's parameters can be empty/no-op for basic queries. The complex ones (lazy sources, orderBy optimization, window functions) are only needed for advanced pagination.

## The bridge we need to write

### Core idea

```
Collection (data source)
  → subscribeChanges (change events)
    → convert to MultiSet entries
      → D2 graph (IVM pipeline from compileQuery)
        → output operator
          → apply to Solid store (granular updates)
```

### Change → MultiSet conversion

This is trivial (from TanStack's `sendChangesToInput`, ~20 lines):

```ts
function changesToMultiSet(changes, getKey) {
  const entries = []
  for (const change of changes) {
    const key = getKey(change.value)
    if (change.type === 'insert') {
      entries.push([[key, change.value], 1])
    } else if (change.type === 'update') {
      entries.push([[key, change.previousValue], -1])
      entries.push([[key, change.value], 1])
    } else {
      entries.push([[key, change.value], -1])
    }
  }
  return new MultiSet(entries)
}
```

### D2 output → Solid store

The D2 output emits `[[key, [value, orderByIndex]], multiplicity]`. We accumulate multiplicities per key (needed for joins that can produce intermediate states for the same key in one graph step), then apply to an array store:

```ts
// Accumulate first (same as TanStack's accumulateChanges)
const pending = new Map()  // key → { inserts, deletes, value }
pipeline.pipe(
  output((data) => {
    for (const [[key, [value, orderByIndex]], mult] of data.getInner()) {
      const entry = pending.get(key) ?? { inserts: 0, deletes: 0, value, orderByIndex }
      if (mult > 0) { entry.inserts += mult; entry.value = value; entry.orderByIndex = orderByIndex }
      else { entry.deletes += Math.abs(mult) }
      pending.set(key, entry)
    }
  })
)

// After graph.run(), flush pending → store
function flush() {
  batch(() => {
    for (const [key, { inserts, deletes, value }] of pending) {
      if (inserts > deletes) {
        // insert or update — find by key or push
        const idx = store.findIndex(r => getKey(r) === key)
        if (idx === -1) setStore(store.length, reconcile(value))
        else setStore(idx, reconcile(value))
      } else if (deletes > 0) {
        // delete — remove from array
        const idx = store.findIndex(r => getKey(r) === key)
        if (idx !== -1) setStore(produce(s => s.splice(idx, 1)))
      }
    }
    pending.clear()
  })
}
```

The store is just an array — `const [store, setStore] = createStore([])`. Consumers iterate with `<For each={store}>`, and Solid's granular tracking means updating one row only re-renders that row's component.

### Lifecycle

```ts
function createLiveQuery(queryFn) {
  // 1. Build query IR
  const queryIR = buildQuery(queryFn)

  // 2. Extract source collections from IR
  const collections = extractCollectionsFromQuery(queryIR)

  // 3. Create D2 graph + inputs per source alias
  const graph = new D2()
  const inputs = Object.fromEntries(
    Object.keys(collectionsByAlias).map(alias => [alias, graph.newInput()])
  )

  // 4. Compile query → D2 pipeline
  const compiled = compileQuery(queryIR, inputs, collections, ...)

  // 5. Attach output → accumulator
  const pending = new Map()
  compiled.pipeline.pipe(output((data) => { /* accumulate into pending */ }))

  // 6. Finalize graph (locks structure, no more operators)
  graph.finalize()

  // 7. Create Solid store (just an array)
  const [store, setStore] = createStore([])

  // 8. Subscribe to each source collection, feed into D2, flush to store
  for (const [alias, collectionId] of Object.entries(compiled.aliasToCollectionId)) {
    const collection = collections[collectionId]
    const whereClause = compiled.sourceWhereClauses.get(alias)

    collection.subscribeChanges((changes) => {
      inputs[alias].sendData(changesToMultiSet(changes, collection.config.getKey))
      graph.run()       // propagate through pipeline
      flush(pending, store, setStore)  // apply accumulated diffs to store
    }, {
      includeInitialState: true,
      whereExpression: whereClause,
    })
  }

  // 9. Return reactive store
  return store
}
```

## What this gets us

- **Granular reactivity**: Solid stores track property access. Updating one row doesn't re-render components reading other rows.
- **IVM efficiency**: When one row changes in a source collection, the D2 graph incrementally updates only affected results — no full re-query.
- **Full query power**: WHERE, JOIN, GROUP BY, ORDER BY, aggregates, subqueries — all from TanStack's query builder.
- **Composable**: sssync materializers write to Collections, queries derive from Collections, Solid stores render the results.

## Integration with sssync

Current sssync flow:
```
events → materializers → InMemoryStore (Solid store of arrays)
```

New flow — **replace InMemoryStore with Collections**:
```
events → materializers → Collection (insert/update/delete)
                            ↓
                     subscribeChanges
                            ↓
                    D2 IVM pipeline (query)
                            ↓
                    Solid store array (granular output)
```

Collections replace InMemoryStore entirely. The materializer `mutate` interface maps directly:
- `action.type === 'create'` → `collection.insert(action.value)`
- `action.type === 'update'` → `collection.update(key, action.value)`

This means the `InMemoryStore` type and its implementations (`createSolidStore`, `createDefaultStore`, `createLegendStore`) go away. Collections are the data layer. Queries produce Solid store arrays for rendering.

## Open questions

1. **Dependency management**: Do we vendor `@tanstack/db` + `@tanstack/db-ivm` into the monorepo (like the `steal/` copy), or install them as npm dependencies? Vendoring gives us the ability to trim unused code and avoid version drift.

2. **Cleanup/disposal**: Need to unsubscribe from collections and tear down the D2 graph when queries are no longer needed. Could use Solid's `onCleanup` in component scope, or a manual dispose pattern.

3. **Delete support**: sssync materializers currently only do `create`/`update`. Collections also support `delete`. May want to add a `delete` action type to materializers.
