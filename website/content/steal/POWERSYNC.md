# Learning from PowerSync (Web SDK)

A study of [PowerSync](https://powersync-ja.github.io/powersync-js/web-sdk)'s public API, read from source (`powersync-ja/powersync-js@main`). The Web SDK (`@powersync/web`) is a thin platform shim over `@powersync/common`, which holds essentially the whole public surface. Same goal as [LEARN.md](./LEARN.md) (Replicache/Zero) and [TINYBASE.md](./TINYBASE.md): understand what a mature local-first sync library decided its users needed, to inform `sssync`.

PowerSync's defining bet, and the thing that makes it different from all three prior systems: **the local store is a real SQLite database, and the developer talks to it in SQL.** There is no KV API (Replicache), no relational query DSL (Zero/ZQL), no reactive-cell tree (TinyBase). You write `SELECT ... FROM todos WHERE ...`, you get rows, and you `watch()` the SQL to make it reactive. Sync is server-driven (a PowerSync Service streams "buckets" of rows down; local writes queue up and you upload them yourself). The mental model is closest to Zero's server-authoritative sync, but the client API is "SQLite that happens to sync."

---

## The architecture in one paragraph

You define a **`Schema`** (tables/columns) that mirrors what the server will sync down. You construct a **`PowerSyncDatabase`** (wraps a SQLite file via a WASM/worker VFS on web). You implement a **`PowerSyncBackendConnector`** with two methods: `fetchCredentials()` (give me a token) and `uploadData()` (push my local changes to your backend). You `connect(connector)`. From then on: **reads** are SQL (`getAll`/`get`/`watch`), **writes** are SQL `INSERT/UPDATE/DELETE` inside `writeTransaction` — which PowerSync intercepts and records into a local **CRUD upload queue** — and a background loop calls your `uploadData` to drain that queue to your real backend. Downloads stream in automatically as the server's sync rules dictate.

The split worth internalizing: **PowerSync owns download + local storage + the upload queue; you own the upload transport and the backend.** It is deliberately backend-agnostic — it never talks to your Postgres directly from the client.

---

## Part 1 — `PowerSyncDatabase` / `AbstractPowerSyncDatabase` (the core)

One class, ~40 public members. Grouped:

### Lifecycle & connection
- `init()`, `waitForReady()` — open/ready gating.
- `connect(connector, options?)` — start syncing; takes the `PowerSyncBackendConnector`. Options include sync params and (experimental) which buckets/streams.
- `disconnect()`, `disconnectAndClear({clearLocal})` — the latter is the **logout primitive**: wipes synced data (optionally preserving local-only tables). The DB is still queryable afterward, just empty.
- `close({disconnect})`, `dispose()`.
- `updateSchema(schema)` — migrate the client schema at runtime.
- `connected` / `connecting` getters; `schema`, `database` getters.
- `getClientId()` — stable per-client id.
- `waitForFirstSync({signal?, priority?})` — **await initial hydration**, optionally to a given sync *priority* level (PowerSync supports prioritized partial sync — critical tables first). This is PowerSync's answer to "don't show the UI until the important data is here," and it's priority-aware, which is unusually granular.

### Reads — it's just SQL
- `get<T>(sql, params)` — single row, throws if none.
- `getOptional<T>(sql, params)` — single row or `null`.
- `getAll<T>(sql, params)` — array of rows.
- `execute(sql, params)`, `executeRaw(...)`, `executeBatch(sql, params[][])` — arbitrary SQL.
- `readTransaction(cb)` / `writeTransaction(cb)` — a `tx` with the same `execute`/`get*` methods, atomic. **Writes must go through `writeTransaction`/`execute` so PowerSync can capture them into the CRUD queue.** There is no `db.put({...})` — you write SQL, and the magic is that PowerSync triggers on those tables record the diff.

Result rows are plain objects; everything is typed only by the `<T>` you supply (no schema-derived row types in the core — though the typed-SQL drivers below add that).

### Reactivity — `watch`, `onChange`, and the newer `WatchedQuery`
Three generations of reactive API coexist (a useful signal of how their thinking evolved):

1. **`watch(sql, params, options)`** — re-runs a query whenever any table it reads changes. Two forms: a callback (`WatchHandler` with `onResult`/`onError`) or an `AsyncIterable<QueryResult>` (you `for await` the result sets). Options (`SQLWatchOptions`): `throttleMs`, `signal` (AbortSignal), `triggerOnTables`, and a `comparator` to suppress emissions when results are unchanged.
2. **`onChange(options)`** — lower-level: fires with the *set of changed table names* (`WatchOnChangeEvent`), not query results. You decide what to re-fetch. Callback or async-iterable. This is the raw table-change firehose `watch` is built on. `resolveTables(sql)` tells you which tables a query depends on.
3. **`query(definition)` / `customQuery(...)` → `Query<RowType>`** — the **current, recommended** reactive builder. `db.query({sql, parameters, mapper?})` returns a `Query` you then call `.watch()` or `.differentialWatch()` on.

### The `WatchedQuery` object (the modern reactive primitive)
`query(...).watch()` returns a `WatchedQuery` (an *instance*, not a stream), with a proper observable state model:

```ts
interface WatchedQueryState<Data> {
  readonly isLoading: boolean;   // hard initial load
  readonly isFetching: boolean;  // re-evaluating (e.g. large query)
  readonly error: Error | null;
  readonly lastUpdated: Date | null;
  readonly data: Data;
}
```
Plus `state`, `closed`, `registerListener({onData, onError, onStateChange, ...})`, `updateSettings(options)` (change SQL/params/throttle live and re-evaluate), and `close()`. The `isLoading`/`isFetching`/`error`/`lastUpdated` split is essentially the React-Query loading model baked into the store — a richer cousin of Zero's `ResultType`.

### Differential watch — incremental diffs out of SQL
`query(...).differentialWatch()` returns a `DifferentialWatchedQuery` whose listener gets a structured diff, not just the new array:

```ts
interface WatchedQueryDifferential<RowType> {
  readonly added: ReadonlyArray<RowType>;
  readonly removed: ReadonlyArray<RowType>;
  readonly updated: ReadonlyArray<{ previous: RowType; current: RowType }>;
  readonly unchanged: ReadonlyArray<RowType>;
  readonly all: ReadonlyArray<RowType>;
}
```
You supply a `compareBy` (e.g. `(item) => JSON.stringify(item)`) or a custom `DifferentialWatchedQueryComparator`. Crucially, **unchanged rows keep their previous object reference**, so React/list rendering can rely on referential identity to avoid re-rendering untouched rows. This is PowerSync re-deriving the add/del/change diff (same triple as Replicache's `experimentalWatch` and TinyBase's listeners) — but computed *on top of* a SQL result set rather than at the storage layer. It's how you get IVM-like ergonomics without an IVM engine: re-run the SQL (throttled), diff the rows yourself, emit the delta.

---

## Part 2 — Writing & the CRUD upload queue

This is the heart of PowerSync's offline-write model, and it's notably *explicit* compared to Zero's mutators.

You write ordinary SQL in `writeTransaction`. PowerSync's SQLite extension records each row change into an internal CRUD queue as a **`CrudEntry`**:
- `op: UpdateType` = `PUT` (insert/replace, all non-null columns) | `PATCH` (update, only changed columns) | `DELETE` (id only).
- `table`, `id`, `opData` (the column values), `transactionId`, `clientId`, `metadata`, `previousValues` (for conflict handling).

You drain it from your connector's `uploadData(db)`:
- `getCrudBatch(limit?)` → `CrudBatch` (flat list across transactions) with `.complete()`.
- `getNextCrudTransaction()` → `CrudTransaction` (one atomic transaction's worth) with `.complete()`.
- `getCrudTransactions()` → `AsyncIterable<CrudTransaction>`.
- `getUploadQueueStats(includeSize?)` → `UploadQueueStats` (count, optional byte size).

You loop: get a batch/transaction, POST it to *your* backend however you like (REST, GraphQL, whatever), call `.complete()`. If `uploadData` throws, PowerSync retries with backoff. **You own the upload semantics; PowerSync owns durability and ordering of the queue.**

Contrast with the others:
- Replicache/Zero: writes are *mutators*, replayed/rebased, server applies them via a defined protocol.
- PowerSync: writes are *SQL*, captured as CRUD ops, and **you hand-write the function that ships them to your backend**. More boilerplate, but zero framework lock-in on the server — PowerSync never needs to understand your backend or run your mutators. Conflict resolution is whatever your backend does plus server-side sync rules; there's no client-side rebase.

---

## Part 3 — Schema (`Schema`, `Table`, `Column`)

Client schema mirrors the synced data. Builder style:

```ts
const lists = new Table({
  name: column.text,
  created_at: column.text,
  owner_id: column.text,
});
const AppSchema = new Schema({ lists, todos });
```

- `column.text | .integer | .real` — only three SQLite affinities (`ColumnType.TEXT/INTEGER/REAL`). No booleans/dates as first-class types — you store them as ints/text. Minimalism on purpose: it's SQLite.
- **No primary-key declaration** — every synced row has an implicit `id` (text UUID) column managed by PowerSync. The schema only declares the *other* columns.
- Table modifiers: `Table.createLocalOnly(...)` (never synced/uploaded — pure local state, survives `disconnectAndClear` if you ask), `Table.createInsertOnly(...)` (writes go to the upload queue but the table stores nothing locally — for append-only event logs), plus indexes (`Index`/`IndexedColumn`).
- **Raw tables** (`RawTable`, `PendingStatement`) — an escape hatch to map sync onto your *own* SQLite tables with custom insert/update/delete SQL, rather than PowerSync's managed JSON-backed tables. For when you need real columns/constraints.

The schema is **declarative and loose** — it describes shape for query convenience and view generation, not validation. Type safety comes from the query drivers, not the schema object.

---

## Part 4 — `SyncStatus` (observability is first-class)

`db.currentStatus` / the `statusChanged` listener expose a rich `SyncStatus`:
- `connected`, `connecting`.
- `dataFlowStatus`: `downloading`, `uploading`, plus `downloadError` / `uploadError`.
- `lastSyncedAt`, `hasSynced`.
- `downloadProgress` → `SyncProgress` / `ProgressWithOperations` — **operation-count progress bars for the initial sync** (downloaded ops / total ops), so you can show "syncing 4,200 / 10,000."
- `priorityStatusEntries` → `SyncPriorityStatus[]` — per-priority sync state (which priority levels have completed), pairing with `waitForFirstSync({priority})`.
- `syncStreams` → per-stream status (the experimental named-streams feature).

PowerSync treats "what is the sync doing right now, and how far along" as a structured, observable, *quantified* part of the API — more detailed than Zero's connection state machine (it has byte/op progress and priority tiers) and far beyond TinyBase (which has none).

### Sync streams (experimental)
`syncStream(name, params?)` → a `SyncStream` you can subscribe to / inspect. This is PowerSync moving toward **client-controlled, parameterized partial sync** (subscribe to just the buckets you need, with params) — conceptually similar to Zero's per-query sync, layered onto the bucket model. Marked alpha.

---

## Part 5 — Triggers (experimental, `TriggerManager`)

A newer low-level API: `db.triggers` lets you install SQLite triggers that **track row-level diffs of specific tables/columns into a temp table**, emitting `TriggerDiffRecord`s (`insert`/`update`/`delete` with the tracked column values, keyed by an operation id). It's the primitive the differential-watch machinery and advanced change-tracking build on, exposed for users who want raw change-data-capture inside SQLite. Echoes TinyBase's `mutator`-listener idea (let the store's own change machinery be a public building block) but at the SQLite-trigger level.

---

## Part 6 — Attachments (`AttachmentQueue`)

A dedicated module for **syncing large binary files** (images, etc.) that don't belong in the row data — something none of the other three systems address. You implement `LocalStorageAdapter` + `RemoteStorageAdapter` (e.g. local filesystem ⇄ S3/Supabase Storage); the `AttachmentQueue` keeps a table of attachment records and reconciles them:
- `saveFile(...)`, `deleteFile(...)`, `getFile(...)`.
- `startSync()` / `stopSync()` — background upload/download loop with periodic reconciliation.
- `expireCache()`, `clearQueue()`, `verifyAttachments()` — cache eviction & integrity.
- Reactive `WatchedAttachmentItem` state per file (queued/uploading/synced/failed).

The lesson: large-blob sync is a separate, explicit subsystem with its own queue/state machine, mirroring the CRUD queue pattern but for files. Real apps need this and most local-first stores punt on it.

---

## Part 7 — Web SDK specifics & framework bindings

### `@powersync/web` additions
The web `PowerSyncDatabase` wraps SQLite-in-WASM. Notable web-only options (`WebPowerSyncFlags` / open factories):
- **Multi-tab coordination**: a `SharedWorker` runs one sync connection shared across all tabs (`enableMultiTabs`); falls back to per-tab when SharedWorker is unavailable. This is the same multi-tab problem Replicache solves with client groups, solved here at the worker level.
- VFS choice (`WASQLiteVFS` — IDBBatchAtomic / OPFS variants) — pluggable storage backend for the WASM SQLite (IndexedDB vs OPFS).
- Custom `worker` URL/factory, encryption key, flags for broadcast logs, SSR-safe mode.

### Framework packages
- `@powersync/react` — `PowerSyncContext` + `usePowerSync()`, `useQuery(sql|Query, params, options)` → `{data, isLoading, isFetching, error}` (React-Query-shaped), `useStatus()`/`usePowerSyncStatus()`, `useWatchedQuery(...)` / `useWatchedQuerySubscription(...)`, `useSuspenseQuery`/`useSingleSuspenseQuery` (Suspense), `useSyncStream(s)`, `useAllSyncStreamsHaveSynced`. The hook result shape matches the `WatchedQueryState` model exactly.
- `@powersync/vue` — equivalent composables.
- `@powersync/tanstack-react-query` — adapter so PowerSync watched queries drive a TanStack Query cache (offline-first + the full TanStack ecosystem).
- **Typed-SQL drivers**: `@powersync/drizzle-driver` and `@powersync/kysely-driver` — wrap the DB so you write Drizzle/Kysely queries (compile-time typed, schema-derived row types) that compile to the SQL PowerSync watches. They implement `compilableQueryWatch` so a Drizzle/Kysely query becomes a reactive `WatchedQuery`. This is how you get type-safe relational queries without PowerSync inventing its own DSL — it leans on existing query builders.
- Platform packages: `@powersync/react-native`, `@powersync/node`, `@powersync/capacitor`, `@powersync/tauri`, `@powersync/op-sqlite`, `@powersync/nuxt` — same `common` API over different SQLite hosts.

---

## What PowerSync thought users needed

### Transplantable ideas for sssync
1. **"It's just SQLite, talk in SQL" is a legitimate API.** No DSL to learn, no KV impedance mismatch, and you get joins/indexes/aggregates for free. Reactivity is bolted on by watching which tables a query touches and re-running (throttled). If sssync sits on SQLite, this is the lowest-friction surface.
2. **Capture writes via DB triggers into an explicit CRUD queue** (`PUT`/`PATCH`/`DELETE` + id + changed columns + transaction id). It decouples "record the change durably" from "ship it," and makes the offline write log inspectable (`getUploadQueueStats`, `getCrudBatch`).
3. **Let the app own the upload transport.** `uploadData(db)` + `getNextCrudTransaction().complete()` means the library never needs to understand your backend. Maximum backend-agnosticism; the cost is boilerplate. A genuine architectural fork vs Zero's "we run your mutators."
4. **`differentialWatch` with stable references for unchanged rows.** Re-run the query throttled, diff with a `compareBy`, emit `{added, removed, updated, unchanged, all}`, and *reuse old row objects* so list UIs skip re-renders. You get IVM-grade rendering ergonomics without an IVM engine.
5. **A real loading-state object** (`isLoading` vs `isFetching` vs `error` vs `lastUpdated`) on every watched query — the React-Query model. Pairs with framework hooks that just forward it.
6. **Quantified, prioritized sync status.** Op-count download progress (`SyncProgress`), per-priority completion (`waitForFirstSync({priority})`, `priorityStatusEntries`), and structured `dataFlowStatus` with separate up/down errors. "Show me a real progress bar and let critical tables sync first" is a feature users clearly asked for.
7. **`disconnectAndClear({clearLocal})` as the logout primitive**, with `localOnly`/`insertOnly` table modifiers so some state survives logout and some tables are write-only event logs. Thoughtful handling of the "what happens to local data on sign-out" question.
8. **Attachments are a first-class, separate queue.** Blob sync ≠ row sync; give it its own adapter pair + queue + per-file reactive state. Most local-first libs ignore this and every real app hits it.
9. **Lean on existing query builders for type safety** (Drizzle/Kysely drivers) instead of inventing a typed DSL — `compilableQueryWatch` turns any compilable query into a reactive watch. Less surface to own, instant ecosystem.
10. **Multi-tab via one shared worker connection.** If sssync targets web, a SharedWorker holding the single sync socket (with graceful fallback) is the clean answer to N tabs.

### The philosophical placement
Across the four systems, PowerSync is the **"bring your own backend, talk in SQL"** point: server-driven download like Zero, but with an explicit client-owned upload queue instead of a mutator protocol, and a SQL surface instead of a DSL. It trades Zero's automatic-rebase / typed-query elegance for radical backend independence and the familiarity of SQLite. For sssync the decision it crystallizes: **how much does the sync engine need to understand your writes?** Zero understands them (mutators, rebase, permissions). PowerSync deliberately does *not* — it just durably queues row diffs and hands them to you. That single choice cascades into the entire upload/conflict/permission story.

---

*Source: `powersync-ja/powersync-js@main` cloned to a tmp folder. Public API read from `packages/common/src` (the `AbstractPowerSyncDatabase` class, `PowerSyncBackendConnector`, `CrudEntry`/`CrudBatch`/`CrudTransaction`, `SyncStatus`/`SyncProgress`, `Schema`/`Table`/`Column`, `Query`/`WatchedQuery`/`DifferentialQueryProcessor`, `TriggerManager`, `AttachmentQueue`) and `packages/web/src` (`PowerSyncDatabase`, `WebPowerSyncFlags`, WASQLite VFS, SharedWorker sync). Framework packages enumerated from `packages/{react,vue,drizzle-driver,kysely-driver,tanstack-react-query,...}`.*
