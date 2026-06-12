## Day 1: Events
- Invent a type-safe event definition system, with niceties like "deprecate" and suggested versioning schema, enforced by type-safe strings
- Perf test IndexedDB appending to decide on debounced batching or consecutive writes

## Day 2: Materializers
- 

## Day 3: Query language
```ts
store.issues.where(q => q.eq("status", "open")) // creates an IVM reactive array
store.issues.single(id) // creates a reactive row
store.issues.related('comments') // creates a fetch for "comments::issue:id" (maybe allow it only after single/where?)
```

This allows for feeding in new data through, without needing to maintain sources in memory.

Updates will just flow through the pipeline, while new queries run against OPFS SQLite on setup. This minimizes memory usage as much as possible while allowing running queries to not need to rerun against disk. 

Joins become "get by id" in all cases.