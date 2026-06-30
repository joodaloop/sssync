# Learning from Electric (TypeScript client)

A study of [Electric](https://electric.ax/docs/sync/api/clients/typescript)'s TypeScript client (`@electric-sql/client`), read from source (`electric-sql/electric@main`, `packages/typescript-client`). Same goal as [LEARN.md](./LEARN.md) (Replicache/Zero), [TINYBASE.md](./TINYBASE.md), and [POWERSYNC.md](./POWERSYNC.md): understand what a mature local-first sync system decided its users needed, to inform `sssync`.

Electric is the **smallest and most opinionated-by-omission** of the five systems studied. Its entire premise: **sync a single Postgres query (a "Shape") to the client over plain HTTP as a log of row changes.** That's it. There is:
- **no local database** (you bring your own store, or just hold rows in memory),
- **no write path** (writes go straight to Postgres through your own API; Electric is read-path only),
- **no query language** on the client (the query lives server-side as the Shape definition; the client just consumes its change log),
- **no mutators, no CRDT, no conflict resolution, no transactions API.**

It is deliberately a **read-path sync primitive**, not a database. The bet: HTTP + Postgres logical replication, exposed as a cacheable, resumable change-log, is a small enough primitive that everything else (local store, writes, framework integration) can be built on top or brought by the user. This makes it the cleanest illustration of "what is the irreducible core of sync?" of the bunch.

---

## The mental model: Shapes and the shape log

A **Shape** is a partial replica of a Postgres table defined by `{ table, where, columns }`. The Electric server (`sync-service`) tails Postgres logical replication and serves each Shape as an append-only **log of change messages** over `GET /v1/shape`, using HTTP long-polling (or SSE) for liveness and **standard HTTP caching** (offsets are cache keys; a CDN can fan out one shape to thousands of clients).

The client's whole job is to consume that log:
1. **`ShapeStream`** — the low-level transport. Connects to the URL, hands you batches of raw `Message`s (changes + control), tracks the `offset` so it can resume, and handles long-poll/SSE/backoff/retries. **Stateless about data** — it keeps no materialized rows, just the log position.
2. **`Shape`** — the optional materializer. Wraps a `ShapeStream`, folds the change log into an in-memory `Map<key, row>`, and notifies subscribers with the current row set. This is the "give me the current rows and keep them live" convenience.

You can use either layer. Most apps that don't have their own store use `Shape`; apps with a local DB (PGlite, etc.) use `ShapeStream` and apply the messages to their store themselves.

---

## Part 1 — `ShapeStream` (the transport core)

`new ShapeStream<T>(options)` then `stream.subscribe(messages => ...)`. The `ShapeStreamInterface`:

**Subscription**
- `subscribe(cb: (messages: Message<T>[]) => ..., onError?)` → unsubscribe fn. The callback receives **batches** of log messages, not individual rows. Returning `{ columns: [...] }` from the callback lets a subscriber declare which columns it cares about (selective notification).
- `unsubscribeAll()`.

**State (plain properties + predicates)**
- `isUpToDate` — has the stream caught up to the latest server state (seen an `up-to-date` control message)?
- `lastOffset: Offset`, `shapeHandle?` — the resume coordinates (persist these to resume across reloads/offline).
- `isLoading()`, `isConnected()`, `hasStarted()`, `lastSyncedAt()`, `lastSynced()`, `error`, `mode`.

**Control**
- `forceDisconnectAndRefresh()` — drop the connection and re-fetch (recover from a bad state).
- `requestSnapshot(params: SubsetParams)` / `fetchSnapshot(opts)` — **request a one-off subset of the shape** (a `WHERE`/`ORDER BY`/`LIMIT`/`OFFSET` slice) without changing the live subscription. This is Electric's answer to pagination/lazy-loading inside a shape — fetch page 2 on demand while the live stream keeps the working set fresh.

### `ShapeStreamOptions` — where the design opinions live
- `url` — the shape endpoint (Electric directly, or **a proxy/your API** — auth and shape-scoping are typically done by proxying this URL).
- `params` — Postgres shape definition lives here: `table`, `where`, `columns`, `replica`. Plus arbitrary user params. **Values can be functions (sync/async)** — resolved in parallel at request time, so auth tokens / dynamic filters refresh automatically.
- `headers` — same function-valued pattern, for auth tokens.
- `offset` + `handle` — resume coordinates; normally automatic, set them to **rehydrate from a persisted cache** after offline.
- `subscribe` — `false` to sync once and stop (snapshot), vs stay live.
- `liveSse` — use Server-Sent Events instead of long-polling for live updates.
- `log: LogMode` — `'full'` (all operations) vs `'changes_only'` (only apply updates/deletes for keys you saw inserted — for tailing a stream without the full initial snapshot).
- `parser` — type coercion of Postgres values.
- `columnMapper` — **bidirectional** snake_case ↔ camelCase mapping (decodes results *and* encodes your `where` clauses), via `snakeCamelMapper()` / `createColumnMapper({...})`.
- `transformer` — post-parse row transform (decryption, coercion); runs after `columnMapper.decode`.
- `onError` — error handler with a **retry-by-return-value protocol**: return `{}` to retry same, `{ headers }` to retry with a refreshed token, `{ params }` to retry with changed filters, or `void` to stop permanently. (Auto-retry already covers 5xx/network/429 with backoff; `onError` is for the rest, e.g. refresh-auth-on-401.)
- `subsetMethod: 'GET' | 'POST'` — POST subset requests to avoid URL-length limits on big `WHERE id = ANY(...)` queries.
- `signal` (AbortSignal), `fetchClient` (inject your own `fetch`), `backoffOptions`, `warnOnHttp`.

The opinion worth noting: **almost everything dynamic is a function-valued option**, resolved per-request. Auth, filters, and headers stay fresh without reconstructing the stream.

---

## Part 2 — The message model (the wire format is the API)

A `Message<T>` is either a `ChangeMessage` or a `ControlMessage`. This log format *is* the public contract (helpers `isChangeMessage` / `isControlMessage` / `isVisibleInSnapshot` are exported).

```ts
type ChangeMessage<T> = {
  key: string                     // stable row identity
  value: T                        // the row (or changed columns for updates)
  old_value?: Partial<T>          // only if replica = 'full'
  headers: {
    operation: 'insert' | 'update' | 'delete'
    txids?: number[]              // Postgres transaction ids — for matching your own writes back
    tags?: MoveTag[]; removed_tags?: ...; active_conditions?: boolean[]  // for shapes with subquery WHEREs
  }
}

type ControlMessage = {
  headers:
    | { control: 'up-to-date' | 'must-refetch'; global_last_seen_lsn?: string }
    | { control: 'snapshot-end' } & PostgresSnapshot
    | { control: 'subset-end' } & SubsetParams
}
```

Key design decisions:
- **`insert`/`update`/`delete` keyed by a stable `key`** — the same add/del/change triple as Replicache's `experimentalWatch`, TinyBase's listeners, and PowerSync's CRUD ops. This is clearly the universal shape for a change log; if sssync emits diffs, match it.
- **`up-to-date` control message** — the stream tells you when you've caught up, so consumers know when a batch represents a consistent snapshot vs mid-stream. Electric's equivalent of Zero's `ResultType: 'complete'` / PowerSync's `hasSynced`, but expressed as an in-band log marker.
- **`must-refetch`** — the server can tell the client "your log is invalid, throw it away and re-snapshot" (e.g. shape definition changed, compaction). The client clears and rehydrates. A clean recovery primitive.
- **`txids`** — change messages carry the Postgres transaction ids that produced them, so a client that wrote to Postgres can **detect when its own write has synced back** (the basis of read-your-writes / optimistic confirmation, built in user-land via `matchStream`).
- **Updates are partial** (only changed columns), and `Shape` merges them (`{...existing, ...value}`).

---

## Part 3 — `Shape` (the materializer)

`new Shape(shapeStream)` folds the log into rows:
- `rows` / `currentRows` — `Promise<T[]>` (resolves once up-to-date) and the synchronous current array.
- `value` / `currentValue` — the `Map<key, row>` form (`ShapeData<T>`).
- `subscribe(({ value, rows }) => ...)` → unsubscribe — fires on changes, but (notably) only re-notifies after `up-to-date` to coalesce a batch into one update.
- `isUpToDate`, `lastOffset`, `handle`, `error`, `isLoading()`, `isConnected()`, `lastSyncedAt()`, `numSubscribers`, `mode`.
- `requestSnapshot(params)` — subset fetch, materialized.
- `unsubscribeAll()`.

It honors `LogMode`: in `changes_only` mode it tracks `insertedKeys` and ignores updates/deletes for rows it never saw inserted — so you can tail a shape's tail without the full set in memory. Small but telling: the materializer is ~300 lines and entirely optional.

---

## Part 4 — Subset / partial fetch (`SubsetParams`)

`requestSnapshot`/`fetchSnapshot` take a `SubsetParams`: `where` + positional `params`, `limit`, `offset`, `orderBy`, or the structured `whereExpr` / `orderByExpr` forms. This lets you **query a slice of a shape on demand** (pagination, search, lazy detail load) over the same endpoint, separate from the live subscription. The exported `compileExpression` / `compileOrderBy` build the serialized expression form, and `columnMapper` auto-encodes client column names into the DB names for these clauses. It's a deliberately narrow "fetch me this page" facility, not a query language — the shape's `WHERE` is still the security/scope boundary.

---

## Part 5 — Experimental: multi-shape & write-matching

`@electric-sql/experimental` adds the pieces real apps assemble:
- **`MultiShapeStream`** / **`TransactionalMultiShapeStream`** — consume several shapes together, the transactional variant grouping changes across shapes by Postgres `txid` so you can apply a multi-table transaction atomically client-side. (Electric's core syncs one shape per stream; cross-shape consistency is opt-in here.)
- **`matchStream(stream, { operation, key })` / `matchBy`** — await a specific change appearing in the log, e.g. wait until your just-written row's `insert` syncs back (matched via `txids`/key). This is the **read-your-writes / optimistic-confirmation** primitive, built on the `txids` header rather than baked into the core.

The fact that these are *experimental add-ons* rather than core API is the whole philosophy: Electric core syncs one shape; everything multi-shape or write-aware is composed on top.

---

## Part 6 — React binding & shape caching

`@electric-sql/react` is tiny:
- `useShape({ ...ShapeStreamOptions, selector? })` → `UseShapeResult<T>`:
  ```ts
  { data: T[], shape: Shape<T>, stream: ShapeStream<T>,
    isLoading: boolean, lastSyncedAt?: number, error, isError: boolean }
  ```
  `selector` lets a component subscribe to a derived slice and re-render only when that slice changes.
- `getShapeStream(options)` / `getShape(options)` + `sortedOptionsHash(options)` — **a process-wide cache of streams/shapes keyed by a hash of their options**. Two components asking for the same shape share one HTTP subscription. This is the equivalent of Zero's query-dedup / PowerSync's shared connection — here it's just a memoized map keyed by canonical options, which is elegantly simple.
- `preloadShape(options)` — warm a shape before render.

The result shape (`data` + `isLoading`/`isError`/`lastSyncedAt`) is the now-familiar React-Query model, minimal version.

There's also `@electric-sql/y-electric` (sync a Yjs doc over a shape) and PGlite integration (apply shape logs into a local Postgres-in-WASM), confirming the pattern: Electric is the **transport**, other libraries are the **store**.

---

## What Electric thought users needed

### Transplantable ideas for sssync
1. **Separate the transport from the materializer.** `ShapeStream` (stateless log consumer, tracks only an offset) vs `Shape` (folds the log into rows). Letting users take just the change-log and apply it to *their own* store — or use the convenience materializer — is a clean layering that fits both "I have a local DB" and "I just want rows."
2. **Make the change log the public contract.** `insert`/`update`/`delete` keyed by a stable `key`, partial updates, plus in-band control messages (`up-to-date`, `must-refetch`). A well-specified log format means the client can be reimplemented in any language and consumers can be generic. This is the same instinct as Replicache publishing its pull/push protocol.
3. **`offset` + `handle` as the entire resume state.** Persist two strings and you can resume a stream after offline/reload without re-downloading. Minimal, cache-friendly, CDN-shardable. A strong argument for designing sssync's sync state to be that small.
4. **Plain cacheable HTTP as the sync transport.** Long-poll/SSE + HTTP caching means a CDN fans out one shape to many clients with zero per-client server state. If sssync can express "current state" as a cacheable URL keyed by offset, it inherits CDN scaling for free.
5. **`must-refetch` as an explicit recovery primitive.** The server can always say "discard and re-snapshot." Having a first-class "your local log is invalid" signal is cleaner than hoping clients reconcile.
6. **Function-valued options resolved per-request** (auth headers, filters, params). Keeps tokens/filters fresh without tearing down and rebuilding the stream — nicer than Replicache's "mutable property" approach for the auth-refresh case.
7. **`txids` for read-your-writes, composed not baked.** Tag each change with the upstream transaction id; let user-land `matchStream` await "my write came back." Electric gets optimistic-confirmation without owning the write path at all.
8. **Bidirectional `columnMapper`.** snake_case↔camelCase that decodes results *and* encodes filter clauses — small, but the bidirectionality (so your `where` uses app names too) is the thoughtful bit.
9. **Process-wide shape cache keyed by a canonical options hash.** Dead-simple sharing of one subscription across many components/usages — no elaborate query manager needed.
10. **Subset/snapshot requests alongside the live stream.** A narrow on-demand `WHERE/LIMIT/OFFSET` fetch over the same endpoint covers pagination/search without a client query engine and without disturbing the live working set.

### The philosophical placement
Electric is the **"sync is just a cacheable HTTP change-log of a Postgres query; everything else is your problem"** extreme. It owns the least of any system here — no store, no writes, no conflict handling — and in exchange it's the most composable and the most operationally boring (it's HTTP; put a CDN in front). The others move the boundary inward: PowerSync adds the local SQLite + upload queue; Zero adds mutators + typed queries + rebase; TinyBase adds the whole reactive store + CRDT. For sssync, Electric sharpens the first question to ask before any API design: **what is the smallest sync primitive, and how much store/write/conflict machinery do you actually want to own versus expose as a log for others to build on?** Electric's answer — own almost nothing, specify the log precisely — is the opposite end of the spectrum from Zero, and the contrast is the most useful thing to hold in mind.

---

*Source: `electric-sql/electric@main` cloned to a tmp folder. Public API read from `packages/typescript-client/src` (`ShapeStream`/`ShapeStreamInterface`/`ShapeStreamOptions` in `client.ts`, `Shape`/`ShapeData` in `shape.ts`, the `Message`/`ChangeMessage`/`ControlMessage`/`Operation`/`Offset`/`LogMode`/`SubsetParams` model in `types.ts`, `column-mapper.ts`, `expression-compiler.ts`), `packages/experimental/src` (`MultiShapeStream`, `matchStream`/`matchBy`), and `packages/react-hooks/src` (`useShape`, `getShape`/`getShapeStream` caching).*
