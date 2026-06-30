# Learning from TinyBase

A study of [TinyBase](https://tinybase.org)'s public API ([essentials guide](https://tinybase.org/api/the-essentials/)), read from source (`tinyplex/tinybase@main`, the published type definitions in `src/@types/<module>/index.d.ts`). Same goal as [LEARN.md](./LEARN.md) (Replicache/Zero): understand what a mature local-first data library decided its users needed, to inform `sssync`.

TinyBase is a different animal from Replicache/Zero. It is a **reactive in-memory data store** first, with sync/persistence/CRDT as *optional layers bolted on*, not the core premise. Where Zero starts from "sync relational queries" and works inward, TinyBase starts from "a tiny reactive store" and works outward. It has **no server, no mutators, no optimistic-rollback model** in the core — those are someone else's concern. Its bet is: give people a fast, fully-reactive, schema-optional local store with a rich set of *derived* data structures (queries, indexes, metrics, relationships, undo), and let sync/persistence plug in underneath via small interfaces.

The whole thing is delivered as ~15 independent modules you compose. The granularity is the lesson: almost every capability Replicache/Zero bake in is a separate, optional TinyBase package.

---

## The data model

Two parallel trees, deliberately tiny and JSON-ish:

- **Tabular data**: `Store → Tables → Table → Row → Cell`. A `Cell` is a `string | number | boolean`. Tables/rows are keyed by string `Id`s (no auto-increment; you own the ids).
- **Key-value data**: `Store → Values → Value`. Standalone `string | number | boolean` keyed by `Id`. This is the "app settings / current user / UI state" lane that sits *beside* the tables.

Everything is addressed by string `Id` paths (`tableId`, `rowId`, `cellId`, `valueId`). There is no query language at the storage layer — reads are direct path access plus *derived* structures (below). `Content = [Tables, Values]` is the whole-store snapshot type.

---

## Part 1 — `Store` (the core, `store` module)

`createStore()` returns a `Store` with a **96-method** interface. It's large because every granularity of read/write/listen is a named method rather than a generic path API. The shape rhymes across the tabular and value lanes.

### Getters (read at every granularity)
`getTables`, `getTableIds`, `getTable`, `getTableCellIds`, `getRowCount`, `getRowIds`, `getSortedRowIds`, `getRow`, `getCellIds`, `getCell`; value side: `getValues`, `getValueIds`, `getValue`. Plus `has*` predicates for every level (`hasTable`, `hasRow`, `hasCell`, `hasValue`, …) and `forEach*` iterators (`forEachTable`, `forEachRow`, `forEachCell`, `forEachValue`, `forEachTableCell`).

**`getSortedRowIds`** is notable: sorting is a first-class read primitive (sort by any cell, asc/desc, with offset+limit), and it has a matching *listener* (`addSortedRowIdsListener`) so a sorted, paginated view stays live. This is TinyBase's answer to "ORDER BY + LIMIT" without a query engine.

### Setters & deleters
`setTables`, `setTable`, `setRow`, `addRow` (auto-assigns a row id), `setPartialRow` (merge, leave unset cells alone), `setCell` (value *or* a `(cell)=>cell` mapper function); value side `setValues`, `setValue`, `setPartialValues`. Deleters mirror them: `delTables`, `delTable`, `delRow`, `delCell`, `delValues`, `delValue`. `setCell` accepting a mapper means you can do `count → count+1` atomically without a read-modify-write race.

### Whole-store I/O
`getContent`/`setContent`, `getJson`/`setJson`, `getTablesJson`, `getValuesJson`, plus `applyChanges` (apply a `Changes` delta) and `getTransactionLog`. Serialization to/from JSON is built into the core — the store *is* its own snapshot format.

### Schemas (optional, declarative)
`setTablesSchema`, `setValuesSchema` (or combined `setSchema`), with `has*`/`del*` variants. A `CellSchema`/`ValueSchema` is:
```ts
{ type: 'string'|'number'|'boolean'|'object'|'array', default?, allowNull?: boolean }
```
Schemas are **optional and additive** — the store works fully untyped (`NoTablesSchema`), and adding a schema gives defaults + type coercion + validation. Invalid writes don't throw; they're rejected and surfaced via `addInvalidCellListener`/`addInvalidValueListener` (a reactive validation channel, not exceptions). The schema can also be expressed in TypeScript types for compile-time safety (the "schematizers" / typed-store generation).

### Transactions
`transaction(() => {...}, doRollback?)` runs a batch; listeners fire **once** at the end with coalesced changes. Also low-level `startTransaction`/`finishTransaction`, and a `doRollback` callback that inspects the changes and can veto the whole commit. Transaction lifecycle is itself observable: `addStartTransactionListener`, `addWillFinishTransactionListener` (can still mutate), `addDidFinishTransactionListener`. `getTransactionChanges`/`getTransactionLog` expose what changed.

### Reactive listeners — the heart of TinyBase

This is the most-copyable part. There is a listener for **every read granularity**, on both lanes:

`addTablesListener`, `addTableIdsListener`, `addTableListener`, `addTableCellIdsListener`, `addRowCountListener`, `addRowIdsListener`, `addSortedRowIdsListener`, `addRowListener`, `addCellIdsListener`, `addCellListener`; value side `addValuesListener`, `addValueIdsListener`, `addValueListener`; existence side `addHasTableListener`, `addHasRowListener`, `addHasCellListener`, `addHasValueListener`, etc.

Two design decisions worth stealing:

1. **Wildcards via `null`.** Listener registration takes id args where `null` means "any." `addCellListener(tableId, rowId, cellId, listener)` with any arg `null` subscribes to all matching — e.g. `addCellListener(null, null, null, …)` fires for *every* cell change, `addCellListener('pets', null, 'sold', …)` for the `sold` cell of any row in `pets`. One method, fully parameterized fan-out, instead of N specific subscriptions.
2. **The `mutator` flag.** Every `add*Listener` takes a trailing `mutator?: boolean`. A listener registered with `mutator: true` is allowed to *write back to the store inside the same transaction* — i.e. **reactive triggers / derived-data maintenance** run before the transaction closes. This is how the higher-level modules (indexes, metrics, relationships, queries) are all built: they're just mutator-listeners on the base store. Exposing that mechanism publicly is the key architectural move.

Listeners return a string `Id`; you remove them with `delListener(id)`. `callListener(id)` forces an immediate call. `getListenerStats()` returns counts by type (debugging/observability).

---

## Part 2 — Derived data structures (each a separate module)

These are the "what did they think users needed" payload. Every one is a thin object that **attaches to a Store**, watches it via mutator-listeners, and maintains a derived view incrementally. Each has the same lifecycle shape: `createX(store)`, `setXDefinition(...)`, getters, `addXListener(...)`, `delXDefinition`, `getStore`, `destroy`. The uniformity is itself a lesson.

### `queries` — TinyQL (the closest thing to SQL)
`createQueries(store)` + `setQueryDefinition(queryId, tableId, ({select, join, where, group, having, param}) => {...})`. A **function-call query builder**, not a chained one:
- `select(cellId)` / `select(joinedTableId, cellId)` / `select((getCell, rowId) => computedValue)` — columns, including computed cells; `.as(alias)`.
- `join(otherTableId, onCellId)` — joins, including **multi-hop** (intermediate joined table) and joins onto *another query's results* (`join(true, queryId, …)`). `.as(alias)`.
- `where(cellId, equals)` or `where((getTableCell) => boolean)` — arbitrary predicates.
- `group(cellId, 'count'|'sum'|'avg'|'min'|'max' | customAggregate, add?, remove?, replace?)` — aggregation with **incremental custom aggregates** (you supply add/remove/replace fns so the aggregate updates in O(1) per row change, not full recompute). `.as(alias)`.
- `having(...)` — post-group filter.
- `param(paramId)` + `setParamValue` — parameterized queries that re-run reactively when params change.

The result is itself a queryable, fully-reactive "result table" with its own family of listeners (`addResultRowListener`, `addResultCellListener`, `addResultSortedRowIdsListener`, `addResultRowCountListener`, …) and getters (`getResultTable`, `getResultSortedRowIds`, …). So a query's output is a live table you can sort/paginate/observe exactly like a base table. **Incremental view maintenance, but expressed as a closure-based DSL over a KV store.**

### `indexes` — secondary indexes / `GROUP BY` buckets
`setIndexDefinition(indexId, tableId, getSliceIdOrIds, getSortKey?, sliceSorter?, rowSorter?)`. An index partitions a table's rows into **slices** keyed by a derived id (one row can be in multiple slices — `getSliceIdOrIds` can return an array, e.g. tags). `getSliceRowIds(indexId, sliceId)` returns the (optionally sorted) row ids in a bucket, with `addSliceRowIdsListener`. This is "give me all rows where colour = 'red', kept live and sorted" without a query.

### `metrics` — live aggregates
`setMetricDefinition(metricId, tableId, 'sum'|'avg'|'min'|'max'|custom, getNumber?, add?, remove?, replace?)`. A single reactive number over a table (row count, total, average…), maintained incrementally with optional custom add/remove/replace. `getMetric` + `addMetricListener`.

### `relationships` — foreign keys, both directions
`setRelationshipDefinition(relId, localTableId, remoteTableId, getRemoteRowId)`. Gives you `getRemoteRowId` (local→one remote), `getLocalRowIds` (remote→many local, the reverse direction maintained for free), and `getLinkedRowIds` (follow a **self-referential** relationship transitively — linked lists / trees). Each direction has a listener. So FKs are a 4-arg definition, and you get the reverse index and graph traversal without extra work.

### `checkpoints` — undo/redo
`createCheckpoints(store)` snapshots transactions into a timeline: `addCheckpoint(label?)`, `goBackward`/`goForward`/`goTo(checkpointId)`, `getCheckpointIds()` (returns `[past[], current, future[]]`), `clear`/`clearForward`, `setSize`. **Undo/redo as a first-class store add-on** — something Replicache/Zero leave entirely to the app. The UI module even exposes `useUndoInformation`/`useRedoInformation` returning `[canUndo, undo, checkpointId, label]` tuples ready to wire to buttons.

---

## Part 3 — Persistence (`persisters` module + ~22 backends)

A `Persister` connects a Store to durable storage via a tiny interface:
- `load(initialContent?)` / `startAutoLoad(initialContent?)` — read once, or subscribe to external changes and keep loading.
- `save()` / `startAutoSave()` — write once, or auto-write on every store change.
- `startAutoPersisting()` — both directions at once.
- `schedule(...)`, `getStatus()` → `Status.Idle | Loading | Saving`, `addStatusListener`, `getStats()` (load/save counts), `stopAutoLoad`/`stopAutoSave`/`destroy`.

The reach is the story — **~22 built-in persisters** ship in the repo: `persister-browser` (local/session storage), `persister-indexed-db`, `persister-file`, `persister-sqlite3` / `sqlite-wasm` / `sqlite-bun`, `persister-expo-sqlite` / `react-native-sqlite` / `react-native-mmkv`, `persister-postgres` / `pglite` / `libsql` / `powersync` / `electric-sql` / `cr-sqlite-wasm`, `persister-durable-object-storage` / `durable-object-sql-storage`, `persister-partykit-client`/`server`, `persister-remote` (HTTP), `persister-yjs`, `persister-automerge`. The last two are telling: TinyBase can persist *into* Yjs/Automerge CRDT docs, i.e. it interops with other sync systems rather than only its own.

**SQL persisters have two mapping modes** (`DatabasePersisterConfig`):
- `DpcJson` (`mode: 'json'`) — dump the whole store as JSON into one cell.
- `DpcTabular` (`mode: 'tabular'`) — map TinyBase tables ⇄ real SQL tables, per-table load/save config, with `DpcTabularCondition` to filter and `DpcTabularValues` for the KV lane. This lets a TinyBase store *be* a real relational schema, syncing both ways with Postgres/SQLite/libSQL.

`createCustomPersister` / `createCustomSqlitePersister` / `createCustomPostgreSqlPersister` let you write your own with minimal boilerplate (you supply get/set/listen; TinyBase supplies the auto-load/save state machine).

---

## Part 4 — Sync & CRDT (`mergeable-store` + `synchronizers`)

This is the optional Replicache/Zero-equivalent layer, and it's structured very differently.

### `MergeableStore` — a CRDT drop-in
`createMergeableStore(uniqueId?)` returns a store with the **same 96-method `Store` interface** plus merge machinery. Internally every cell/value is stamped: `Stamp<Thing> = [thing, hlc, hash?]` where `hlc` is a **Hybrid Logical Clock** timestamp and `hash` enables Merkle-style diffing. It's a last-write-wins-per-cell CRDT keyed on HLCs.

Extra methods: `getMergeableContent()`, `getMergeableContentHashes()`, and per-level hash/diff getters (`getMergeableTableHashes`/`getMergeableTableDiff`, `getMergeableRowDiff`, `getMergeableCellDiff`, …), `applyMergeableChanges(changes)`, and `merge(otherStore)` for direct two-store reconciliation. The hash hierarchy means two stores can sync by **exchanging hashes top-down and only shipping the subtrees that differ** — efficient delta sync without a server sequence number.

The key design choice: **CRDT-ness is a swap-in store type, not a different API.** Your app code (and all the indexes/metrics/queries/UI built on top) doesn't change — you just `createMergeableStore()` instead of `createStore()` and it becomes syncable. Contrast Replicache/Zero, where sync is the entire premise.

### `synchronizers`
A `Synchronizer` *is a `Persister`* (`extends Persister<MergeableStoreOnly>`) with `startSync`/`stopSync`. Because sync is modeled as "persist into another peer," it reuses the whole persister state machine. Built-ins: `synchronizer-ws-client` / `ws-server` / `ws-server-simple` / `ws-server-durable-object` (WebSocket, incl. Cloudflare DO), `synchronizer-broadcast-channel` (cross-tab, no server), `synchronizer-local` (in-memory, for testing). `createCustomSynchronizer` takes just `send`/`receive` functions — sync transport is a 2-function interface.

Note what's **absent** vs Zero: no server-authoritative mutators, no per-client mutation log, no rebase, no permissions, no optimistic-rollback. TinyBase's sync is **peer CRDT merge**; conflict resolution is automatic LWW-per-cell, and "the server" is just another peer (often a relay). Simpler, but it pushes invariants/validation onto the app.

---

## Part 5 — UI bindings (`ui-react`, plus solid/svelte/dom variants)

`ui-react` alone exposes **162 hooks** + a parallel set of reactive **components**. The surface is enormous because it mirrors *every* store/query/index/metric/relationship/checkpoint read as both a hook and a component. Patterns worth noting:

- **A hook per read granularity**: `useTables`, `useTable`, `useRowIds`, `useSortedRowIds`, `useRow`, `useCell`, `useValue`, `useResultTable`, `useResultSortedRowIds`, `useMetric`, `useSliceRowIds`, `useRemoteRowId`, `useLinkedRowIds`, `useCheckpoint`… each re-renders only when that exact slice changes.
- **`useXState` write-bound hooks**: `useCellState`/`useRowState`/`useValueState`/`useParamValueState` return `[value, setValue]` like `useState`, but backed by the store — two-way binding to a cell.
- **Callback factory hooks**: `useSetCellCallback`, `useAddRowCallback`, `useDelRowCallback`, `useSetPartialRowCallback`, `useGoBackwardCallback`, `useSetCheckpointCallback`, … return memoized event handlers that write to the store (with a `getValue`-from-event mapper + deps), so JSX stays declarative.
- **`useCreateX` + `useProvideX` + context**: `useCreateStore`/`useCreateQueries`/`useCreateMergeableStore`/`useCreatePersister`/`useCreateSynchronizer` create-once-memoized instances; `Provider` + `useProvideStore`/`useStoreOrStoreById` share them by id through context (you can have many named stores/queries/etc. in one tree).
- **Listener hooks**: `useRowListener`, `useCellListener`, `useResultRowListener`, `useDidFinishTransactionListener`, … register raw listeners with auto-cleanup.
- **Declarative components**: `<TableView>`, `<SortedTableView>`, `<RowView>`, `<CellView>`, `<ResultTableView>`, `<SliceView>`, `<LinkedRowsView>`, `<CheckpointView>`, … render store data with customizable per-row/per-cell components — a whole reactive view layer with zero manual subscription code.
- Parity packages: `ui-solid`, `ui-svelte`, `ui-react-dom` (prebuilt table/sortable editable DOM components), `ui-react-inspector` (a live in-app store inspector/debugger), `ui-react-dom-charts`.

The takeaway: TinyBase treats the **UI binding as a first-class, exhaustively-complete product surface**, not a thin wrapper — every data primitive has a matching hook, a matching component, a matching write-callback, and a matching listener hook.

---

## What TinyBase thought users needed

### Transplantable ideas for sssync
1. **Listener-per-granularity with `null` wildcards.** One parameterized subscribe method per read shape, where `null` = "any," beats both a single firehose and N bespoke subscriptions. Cheap to implement, very ergonomic.
2. **Public `mutator`-listener triggers.** Letting a listener write back within the same transaction is the mechanism that lets *all* derived structures (indexes/metrics/queries) be built as ordinary listeners on the base store. If sssync exposes this, advanced users build their own derived data without engine changes.
3. **Derived data as small, uniform, attachable modules** (`createX(store)` → `setXDefinition` → getters + listeners + `destroy`). Indexes, metrics, relationships, sorted/paginated views, undo — each ~100 lines of public API, each optional. Keeps the core tiny.
4. **`getSortedRowIds` + its listener** = ORDER BY / LIMIT / pagination without a query engine. A live sorted id list is a great primitive.
5. **CRDT as a drop-in store variant** (`createMergeableStore` shares the exact `Store` interface). If sync/CRDT can be a swap-in that leaves app + derived code untouched, adoption is incremental.
6. **Hash-hierarchy delta sync** (per-table/row/cell Merkle hashes + HLC stamps) — sync by exchanging hashes top-down and shipping only differing subtrees. A serverless alternative to Replicache's `lastMutationID` sequence model.
7. **Persister as a tiny state machine** (`load`/`save`/`startAuto*`/`getStatus`) with `createCustomPersister` handling the auto-load/save plumbing — and a **tabular mode** that maps the store onto a real SQL schema both ways. Plus: interop persisters into *other* CRDTs (Yjs/Automerge) rather than assuming you own the whole stack.
8. **Schema validation as a reactive channel, not exceptions** (`addInvalidCellListener`) — writes never throw; invalidity is observable. Fits an optimistic/offline model where you don't want writes to hard-fail.
9. **Undo/redo (`checkpoints`) belongs in the library.** Replicache/Zero punt on it; TinyBase shows it's a natural ~15-method add-on once you have transaction snapshots.
10. **Exhaustive, mechanical UI bindings.** A hook + component + write-callback + listener-hook for every primitive, shared by id through context, across React/Solid/Svelte. Tedious to build, but it's what makes the store feel native in a UI.

### The big philosophical contrast
Replicache/Zero are **honest about distributed-systems uncertainty** — most of their API surfaces "is this confirmed? accepted? online? stale?" TinyBase is **honest about locality** — the store is synchronous, always-available, and reactive, and it refuses to make the happy path pay for sync that many apps don't need. Sync, when wanted, is automatic CRDT merge with no server semantics to reason about. The tradeoff is real: TinyBase gives you no `ResultType`, no server-authoritative validation, no permissions, no rebase — so multi-user correctness/security beyond LWW is on you. For sssync, the question their contrast poses is: **is the local store the product (with sync optional), or is sync the product (with the store as its cache)?** That choice determines almost everything else about the API.

---

*Source: `tinyplex/tinybase@main` cloned to a tmp folder. Public API read from `src/@types/<module>/index.d.ts` for: `store` (96-method `Store`), `queries`, `indexes`, `metrics`, `relationships`, `checkpoints`, `mergeable-store`, `persisters`, `synchronizers`, `ui-react` (162 hooks), `common`. Built-in persister/synchronizer backends enumerated from `src/persisters/*` and `src/synchronizers/*`.*
