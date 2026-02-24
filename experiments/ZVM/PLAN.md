# MyZero Experiment Plan (Granular Change Stream)

## What We Know So Far

- Reusing ZQL as a standalone in-memory IVM engine is feasible.
- We do not need `zero-client` (Replicache runtime) for this experiment.
- We can construct table sources directly with:
  - `new MemorySource(tableName, columns, primaryKey)`
- ZQL already supports table routing through `QueryDelegate.getSource(tableName)`.
- ZQL update ingestion format is `SourceChange`:
  - `{type: 'add', row}`
  - `{type: 'remove', row}`
  - `{type: 'edit', row, oldRow}`
- ZQL has a view subscription API (`addListener`, `data`), but that is snapshot-oriented.
- For true granular updates, we should consume the `Change` stream via `Output.push(change)`.

## Clarification: Granular vs Snapshot Listeners

- Snapshot listener:
  - Uses typed views (`ArrayView` / `materialize`) and receives full result state updates.
- Granular listener:
  - Uses the operator pipeline output path (`push(change: Change)`) to observe each incremental delta.

This is aligned with `zero-solid` behavior: `SolidView` implements `Output` and receives `push(change: Change)` calls, then batches/apply logic on top.

## Scope of This Experiment

Implement a tiny in-memory client class, `MyZero`, with no persistence and no network:

1. Accept a schema
2. Create and manage `MemorySource`s per table
3. Accept initial rows + incremental updates in `SourceChange` format
4. Build query pipelines from ZQL
5. Expose a granular change subscription API that logs each `Change`

## Proposed `MyZero` Shape (Minimal)

```ts
class MyZero {
  constructor(schema)

  // data/source management
  registerTable(tableName)
  seed(tableName, rows)
  ingest(tableName, change) // SourceChange

  // query
  query() // createBuilder(schema)

  // granular stream
  subscribeChanges(query, listener) // listener(change: Change)
}
```

## Implementation Approach

### 1) Delegate + Source Registry

- Build a small delegate extending `QueryDelegateBase`.
- Implement:
  - `defaultQueryComplete = true` (in-memory local-only)
  - `getSource(tableName)` from an internal `Map<string, MemorySource>`

### 2) Ingestion API

- `ingest(tableName, change)` routes to source and calls `consume(source.push(change))`.
- `seed(tableName, rows)` is sugar for repeated `add` changes.

### 3) Granular Change Subscription

- Use `buildPipeline(ast, delegate, queryID)` and attach a custom `Output` sink.
- In sink `push(change)`, call subscriber callback immediately.
- Optional: maintain snapshot as a second mode later (not required now).

### 4) Demo Flow

- Define schema
- Seed rows
- Create query
- Subscribe to granular stream
- Apply `add/edit/remove`
- `console.log` each incoming `Change`

## Packages Needed

For this experiment, effectively:

- `zql` (required)
- `zero-schema` (optional but recommended if using standard schema builder)

Transitive type/runtime dependencies (`zero-protocol`, `zero-types`, `shared`) are part of the local workspace graph.

## Risks / Caveats

- Public package exports may not expose all low-level symbols needed for custom granular sinks in an external project; inside this mono-repo we can import internals directly.
- Some APIs are designed around commit/flush semantics for view materialization; granular sink should document whether events are immediate per push or buffered.
- Query hash/ID strategy for pipeline instances should be simple and explicit in the experiment.

## Next Steps

1. Create `MyZero` class with source map + delegate.
2. Add `ingest` and `seed` methods using `SourceChange`.
3. Add `subscribeChanges(query, listener)` by wiring a custom `Output` sink to pipeline input.
4. Add one runnable example script that logs granular `Change` events.
5. Add minimal tests for:
   - source routing by table
   - add/edit/remove propagation
   - listener unsubscribe behavior
