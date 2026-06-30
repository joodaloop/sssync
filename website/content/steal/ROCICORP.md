# Learning from Replicache & Zero

A study of the public APIs of [`@rocicorp/replicache`](https://github.com/rocicorp/mono/tree/main/packages/replicache/src) and [`@rocicorp/zero`](https://github.com/rocicorp/mono/tree/main/packages/zero) (the rocicorp/mono monorepo), done to understand what a mature sync library decided its users needed. The goal is to inform `sssync`'s own public surface.

Replicache is the older, lower-level KV-sync engine (a sorted key/value cache with mutators + pull/push). Zero is the newer, higher-level system built on the same persistence/sync machinery but exposing a **typed relational query language (ZQL)**, server-authoritative incremental view maintenance (IVM), and a schema/permissions system. Reading them side-by-side is essentially watching the same team's opinion evolve from "sync a KV store" to "sync the results of relational queries."

---

## Part 1 — Replicache

The entire public API is one barrel file (`src/mod.ts`). It's small and deliberate. The whole model: a named local KV database, a set of **mutators** that are the only way to write, and **pull/push** to reconcile with a server. Reads are reactive via `subscribe`/`experimentalWatch`.

### The `Replicache` class — the core surface

Constructed with `new Replicache(options)`. Notable members:

**Writes go through mutators, nothing else.**
- `mutate` — the registered mutators, typed. `rep.mutate.createTodo({...})`. This is the *only* write path. Mutators run optimistically on the client immediately, then are replayed/rebased during sync, then applied authoritatively on the server.
- Mutators are required to be **idempotent and replayable** — they run once locally and may be re-run multiple times during rebasing. The docs explicitly warn: mutators must not touch app state directly, and the set of mutator *names* may only grow over time (forward-compat; an unknown mutator becomes a no-op).

**Reads are transactional and reactive.**
- `query(body: (tx: ReadTransaction) => R)` — one-shot consistent read.
- `subscribe(body, {onData, onError, isEqual})` — reactive query. Re-runs `body` only when keys it *actually touched* change, and only fires `onData` when the result differs (default deep-equal, overridable via `isEqual`). The body must be a pure function of `tx`.
- `experimentalWatch(callback, options)` — lower-level, higher-performance reactivity. Instead of re-running a query and diffing results, it hands you the raw **diff** of changed keys. Trades DX for speed.
- `experimentalPendingMutations()` — inspect not-yet-confirmed local mutations.

**Sync control (mostly automatic, manually overridable).**
- `pull({now})` / `push({now})` — usually automatic; `now: true` bypasses delays & backoff.
- `poke(poke)` — apply a server-pushed update directly (the realtime path; server "pokes" the client to pull).
- `pullURL` / `pushURL` / `auth` / `pullInterval` / `pushDelay` are all **live mutable properties** — change them and the next request uses the new value.
- `puller` / `pusher` — swappable functions if you need custom transport (default is POST-JSON).
- `getAuth` — called on HTTP 401 to re-acquire a token.

**Lifecycle & observability callbacks.**
- `onSync(syncing: boolean)` — transitions between "something in flight" and idle (good for spinners).
- `onOnlineChange(online)` + `online` getter — best-effort connectivity heuristic.
- `onUpdateNeeded(reason)` — fired when the client code is too old (new client group with different mutators/indexes/schema, or server rejects the push/pull/schema version). Default: reload the page.
- `onClientStateNotFound()` — the persistent client was GC'd (e.g. tab backgrounded past `clientMaxAgeMs`). Default: reload.
- `close()` / `closed`.
- Identity getters: `clientID`, `clientGroupID`, `profileID`, `name`, `idbName`, `schemaVersion`.

### `ReplicacheOptions` — what's configurable at construction

- `name` (required) — keys the local DB. Convention is to namespace per user (`name: \`${userID}\``) so different users' data never mixes. Instances with the same name+origin+profile share persisted state and can sync peer-to-peer offline.
- `mutators` — the mutator map.
- `pushURL` / `pullURL` / `auth` / `pusher` / `puller`.
- `schemaVersion` — versions both mutators (push) and the client view (pull).
- `pullInterval` (default 60s, `null` to disable), `pushDelay`.
- `indexes` — secondary index definitions (see below).
- `kvStore` — `'mem' | 'idb' | StoreProvider`. The storage layer is pluggable; there are separate entrypoints for `expo-sqlite`, `op-sqlite`, `sqlite`.
- `logLevel` + `logSinks` — structured logging, pluggable sinks (e.g. ship to Datadog), `consoleLogSink` exported.
- `clientMaxAgeMs` (default 24h) — how long a backgrounded client survives before GC.

### Reads: `ReadTransaction` / `WriteTransaction`

`ReadTransaction`:
- `get(key)`, `has(key)`, `isEmpty()`
- `scan(options)` → `ScanResult`
- `clientID`, `location` (`'client' | 'server'` — same tx code can run in both places)

`WriteTransaction extends ReadTransaction`:
- `set(key, value)` (`put` is the deprecated alias), `del(key)`
- `mutationID`, `reason` (`'initial' | 'rebase' | 'authoritative'`) — so a mutator can tell *why* it's running.

Returned values are typed `DeepReadonly<T>` — immutability is enforced statically, not at runtime (perf), with a clear "mutate this and you get UB" warning.

### `scan` — the read primitive worth copying

`scan` is the workhorse. Two shapes:

```ts
// Primary key space
scan({ prefix?, limit?, start?: { key: string, exclusive?: boolean } })
// Secondary index
scan({ indexName, prefix?, limit?, start?: { key: [secondary, primary?], exclusive? } })
```

`ScanResult<K, V>` is an `AsyncIterable<V>` with `.values()`, `.keys()`, `.entries()`, and `.toArray()`. Index scans key on a `[secondary, primary]` tuple. The design choices to note: **prefix + ordered keys + cursored start** is the entire query model — there's no query language, just sorted scans, and that's enough to build an app on.

### Indexing (`IndexDefinition`)

```ts
indexes: {
  byAge: { prefix: '/user/', jsonPointer: '/age', allowEmpty?: false }
}
```

An index is defined by: a **key prefix** to limit what's indexed, and a **JSON Pointer** (RFC 6901) into each value selecting the field to index on. That's it — declarative secondary indexes over a KV store, no query planner. `allowEmpty` silences the warning for missing/empty indexed fields.

### The diff/watch model (`experimentalWatch`)

The reactive primitive under `subscribe`. Watch options:
- `prefix` — only changes to keys under this prefix.
- `indexName` — watch an index map instead of the primary space.
- `initialValuesInFirstDiff` — if true, the first callback synthesizes an `add` diff for *all existing matching values*, so a watcher can build initial state and then stay live from one code path.

The diff is `readonly DiffOperation[]` where each op is `{op:'add', key, newValue}` | `{op:'del', key, oldValue}` | `{op:'change', key, oldValue, newValue}`. The callback is never invoked with an empty diff. This add/del/change triple with old+new values is the canonical shape — worth matching exactly so downstream consumers can be generic.

### Other exposed utilities
- `dropDatabase` / `dropAllDatabases` / `deleteAllReplicacheData` — cleanup, important for "log out / switch user."
- `makeIDBName`, `IDBNotFoundError`.
- `getDefaultPuller` / `getDefaultPusher` — so you can wrap rather than replace the default transport.
- `PatchOperation`, `Cookie`, `PullResponse`, `Pusher`/`Puller` types — the wire protocol is part of the public type surface, letting people implement servers in any language.
- `TransactionClosedError`, `PullError` — typed errors.

### Replicache takeaways for sssync
1. **One write path (mutators), everywhere.** No ad-hoc `db.put`. Optimistic-by-construction, rebasable, idempotent. The whole consistency story hinges on this.
2. **Reactivity has two tiers:** ergonomic (`subscribe`, re-run + diff results) and fast (`watch`, raw key diffs). Offer both; people graduate to the second when perf matters.
3. **The wire protocol is public and language-agnostic** (pull/push/poke + cookies + patch ops). It's not coupled to a specific backend.
4. **Everything tunable is a live property**, not a constructor-only setting.
5. **Storage is pluggable** behind a tiny `KVStore` interface, with `'mem'`/`'idb'` builtins and SQLite entrypoints.
6. **Lifecycle escape hatches** for the unavoidable distributed-systems realities: client GC, version skew, online/offline, auth expiry — each a callback that defaults to "reload" but can be overridden.

---

## Part 2 — Zero

Zero keeps Replicache's persistence/sync core but replaces "scan a KV store" with **typed relational queries that sync incrementally**. The `zero` package is mostly a re-export hub; the real surface lives in `zero-client`, `zql`, `zero-schema`, `zero-permissions`, plus framework bindings (`zero/react`, `zero/solid`) and server adapters (`zero/server/adapters/{drizzle,kysely,prisma,pg,postgresjs}`).

### The big conceptual shift
- Replicache: *you* maintain derived state by scanning keys and reacting to diffs.
- Zero: you write a **query**, call `materialize()`, and get a **live view** that the system keeps up to date via incremental view maintenance (IVM). The server is authoritative and only the rows a client's queries touch are synced (server-driven sync, not full-dataset replication).

### Defining a schema (`zero-schema`)

A fluent builder, fully type-inferred:

```ts
const user = table('user')
  .columns({
    id: string(),
    name: string(),
    age: number().optional(),
    metadata: json(),
    role: enumeration<'admin' | 'user'>(),
  })
  .primaryKey('id');

const schema = createSchema({ tables: [...], relationships: [...] });
```

- Column types: `string`, `number`, `boolean`, `json`, `enumeration`. `.optional()` marks nullable.
- `.from('server_name')` on tables *and* columns maps client names to a different server/Postgres name — decoupling client schema from DB schema.
- `relationships(table, ({ many, one }) => ({...}))` defines edges as `{ sourceField, destField, destSchema }`. `many` and `one` give cardinality. Junction/through relationships are supported by chaining.

### ZQL — the query API (`zql/src/query/query.ts`)

A chainable, immutable query builder. Each method returns a new `Query` with the return type refined:

```ts
z.query.issue
  .where('status', '=', 'open')
  .where(({ and, or, cmp, exists }) => and(cmp('priority','>',3), exists('labels')))
  .related('comments', q => q.where('deleted', '=', false).limit(10))
  .related('author')
  .whereExists('labels', q => q.where('name','=','bug'))
  .orderBy('createdAt', 'desc')
  .start(lastRow, { inclusive: false })  // cursor pagination
  .limit(50)
  .one();  // singular result (TReturn | undefined)
```

- `where(field, op, value)` or shorthand `where(field, value)` (implicit `=`), or `where(expressionFactory)` for compound logic.
- Operators (`SimpleOperator`): `=`, `!=`, `IS`, `IS NOT`, `<`, `>`, `<=`, `>=`, `LIKE`, `NOT LIKE`, `ILIKE`, `NOT ILIKE`, `IN`, `NOT IN`. `escapeLike()` helper exported.
- Expression builder (passed to `where(cb)`): `and`, `or`, `not`, `cmp`, `cmpLit`, `exists`. Composable boolean trees.
- `related(name, cb?)` — **the headline feature**: nested/recursive subqueries that hydrate relationships into the result tree, each independently filterable/limitable. The result *type* grows to include the nested rows.
- `whereExists(relationship, cb?, {flip?})` — correlated existence filters (SQL `EXISTS`).
- `start(row, {inclusive})` — cursor pagination off a previous row (not offset-based).
- `one()` — collapse to a single optional row.
- Queries are values: parameterizable, serializable to an AST (`AST` type is public), and sent to the server to drive sync.

### Running queries — three execution modes

These live on the `Zero` instance (the per-query methods are now deprecated in favor of `z.run(query)` / `z.materialize(query)` / `z.preload(query)`):

1. **`materialize(query, options?)` → `TypedView`** — a live, incrementally-maintained view.
   ```ts
   type TypedView<T> = {
     readonly data: T;
     addListener(cb: (data, resultType, error?) => void): () => void;
     updateTTL(ttl): void;
     destroy(): void;
   };
   ```
   `resultType` is `'unknown' | 'complete' | 'error'` — **the loading-state model is first-class**: `unknown` = local/optimistic data, possibly stale; `complete` = confirmed fresh from server; `error` = query failed. This is the single most-copyable idea: every reactive result carries whether it's authoritative yet.

2. **`run(query, { type: 'unknown' | 'complete', ttl? })` → Promise** — one-shot. `'unknown'` (default) resolves immediately with whatever's local; `'complete'` waits for the server round-trip to guarantee freshness.

3. **`preload(query, { ttl? })` → { complete: Promise, cleanup: () => void }`** — warm the cache without holding results in memory. The documented use case: preload after login so the next page has no loading flash.

A custom `ViewFactory` can be passed to `materialize` to integrate with any UI framework's reactive primitives.

### TTL — query lifetime management (`zql/src/query/ttl.ts`)

```ts
type TTL = `${number}${'s'|'m'|'h'|'d'|'y'}` | 'forever' | 'none' | number;
```

Every query/view/preload has a **TTL**: how long Zero keeps syncing the query's rows *after* the last subscriber drops. `'5m'` default, `'10m'` max (configurable server-side), `'none'` = drop immediately, `'forever'` = never. This is how Zero handles "user navigates back to a page" cheaply — the rows are still warm. `updateTTL()` lets you extend a live view. This replaced the older `maxRecentQueries` knob (now deprecated). A genuinely non-obvious feature: **caching is expressed as time-to-live on queries**, not on rows.

### Mutators (`zql/src/mutate`)

Zero has two generations:

**Legacy CRUD mutators** (auto-generated from schema, behind `schema.enableLegacyMutators`):
```ts
z.mutate.issue.insert({...});
z.mutate.issue.upsert({...});
z.mutate.issue.update({ id, title });  // partial — unspecified fields untouched
z.mutate.issue.delete({ id });
z.mutateBatch(m => { m.issue.create(...); m.comment.create(...); });  // atomic batch, deprecated
```
`InsertValue` / `UpsertValue` / `UpdateValue` / `DeleteID` are derived from the table schema (update is a partial over non-PK fields + the PK).

**Custom mutators** (the current recommendation) — `defineMutator`:
```ts
const mutators = {
  issues: {
    create: defineMutator(({ tx, args }) =>
      tx.mutate.issues.insert({ id: nanoid(), ...args })),
  },
};
const z = new Zero({ schema, mutators });
await z.mutate.issues.create({ title: 'x' });
```

The mutator `tx` (`Transaction<S>`) exposes:
- `tx.mutate` — typed CRUD per table.
- `tx.query` — **full ZQL read access inside a mutation** (read-your-writes within the mutator).
- `tx.location` (`'client' | 'server'`), `tx.reason` (`'optimistic' | 'rebase' | 'authoritative'`), `tx.clientID`.
- On the server, `ServerTransaction` additionally exposes `tx.dbTransaction` — the raw DB transaction (Postgres/Drizzle/Kysely/Prisma), so the same mutator can run optimistically on the client and authoritatively against the real DB on the server, **sharing code**.

The same shape as Replicache mutators (`reason`, `location`, idempotent/rebasable) but with relational reads/writes instead of KV.

### Mutator result — split client/server promises (`zero-client/src/client/custom.ts`)

```ts
type MutatorResult = {
  client: Promise<MutatorResultDetails>;  // applied optimistically
  server: Promise<MutatorResultDetails>;  // confirmed by server
};
await z.mutate.issues.create({...}).client;   // wait for local
await z.mutate.issues.create({...}).server;   // wait for server ack
```

A mutation returns **two awaitable promises** — one for the optimistic local apply, one for server confirmation (which can reject independently, e.g. permission denied). This cleanly models "the write is on screen instantly, but might be rejected." Worth copying directly.

### Named / synced queries (`zql/src/query/named.ts`, `query-registry.ts`)

`syncedQuery` / `defineQuery` / `defineQueries` register **named, parameterized, server-validated queries**. Instead of the client sending an arbitrary AST, it sends `{ name, args }`, and the server resolves it through a registered definition (optionally with a `Parser`/`withValidation` for arg validation and an auth `context`). This is the permission/safety story for queries — the server controls what queries are even expressible, analogous to stored procedures vs raw SQL. `CustomQueryID`, `QueryFn`, `SyncedQuery`, the whole registry, and `createBuilder` are public.

### Permissions (`zero-permissions`)

```ts
definePermissions(schema, () => ({
  issue: {
    row: { select: ANYONE_CAN, insert: [...], update: {...}, delete: NOBODY_CAN },
  },
}));
```
Row-level read/write rules expressed *as ZQL expressions* evaluated against an auth context. Helpers `ANYONE_CAN`, `NOBODY_CAN`, `ANYONE_CAN_DO_ANYTHING`. Rules compile to a `CompiledPermissionsConfig`. Permissions are part of the schema/deploy artifact, not scattered through handlers.

### Connection lifecycle (`zero-client/src/client/connection.ts`)

A first-class, subscribable connection API — much richer than Replicache's boolean `online`:

```ts
z.connection.state.subscribe(s => { ... });  // Source<ConnectionState>
await z.connection.connect({ auth: newToken });
```
`ConnectionState.name` ∈ `disconnected | connecting | connected | needs-auth | error | closed`. Key distinctions: `needs-auth` (401/403 — paused until the app supplies a new token via `connect({auth})`) and `error`/`closed` (terminal — must make a new instance). `Source<T>` is a generic observable (`{ current, subscribe }`) — a reusable reactive primitive. Note the explicit guidance: **changing `auth` while connected refreshes server-side auth and re-transforms queries without reconnecting**; switching *users* recreates the instance.

### The Inspector — built-in debugging/observability API

A genuinely interesting "what did users need" signal: there's a whole `z.inspector` API for introspecting the live client.

- `inspector.client` / `inspector.clientGroup`, `inspector.clients()`, `inspector.serverVersion()`, `inspector.metrics()`.
- `client.queries()` → `InspectorQuery[]`, `client.map()` (raw KV), `client.rows(tableName)` (decoded rows per table).
- `inspector.analyzeQuery(query)` / `analyzeNamedQuery` / `analyzeServerAST` — query plan analysis (also exposed as a `zero/analyze` entrypoint and `AnalyzeQueryResult`/`PlanDebugEventJSON` types).
- `InspectorQuery` exposes per-query telemetry: `got`, `ttl`, `inactivatedAt`, `rowCount`, `deleted`, `clientZQL`/`serverZQL` (the query as run on each side), and hydration timings `hydrateClient`/`hydrateServer`/`hydrateTotal`.

Lesson: a sync engine is opaque and frustrating to debug; shipping a structured introspection API (what queries are active, how many rows, how long they took, client-vs-server form) is treated as a core feature, not an afterthought.

### Framework bindings (`zero/react`, `zero/solid`)

React surface (`zero-react`):
- `ZeroProvider` / `useZero()` / `createUseZero()` — context plumbing; the provider also handles auth changes and client replacement on `onClientStateNotFound`.
- `useQuery(query, options?)` → `readonly [data, QueryResultDetails]`.
  - `QueryResultDetails` is `{type:'complete'} | {type:'unknown'} | {type:'error', error, retry(), refetch()}` — **the loading state and a retry callback are returned inline with the data.**
  - Options: `{ enabled?, ttl? }` (`enabled:false` disables the query; TTL controls cache lifetime).
- `useSuspenseQuery(query, { suspendUntil: 'partial' | 'complete', ttl })` — Suspense integration, with control over whether to suspend until optimistic-partial or fully-complete results.
- `useConnectionState()`, `useZeroOnline()` — reactive connection/online hooks.

The `[data, details]` tuple with an embedded `type`/`error`/`retry` is the ergonomic payoff of the `ResultType` model threaded all the way to the UI.

### `ZeroOptions` — notable knobs beyond Replicache's
- `cacheURL` (the zero-cache endpoint), `auth`, `userID` (per-user storage), `storageKey` (multiple instances per user), `schema`, `mutators`.
- `mutateURL` / `mutateHeaders` / `queryURL` / `queryHeaders` — custom API endpoints + headers for the push (mutate) and query-resolution paths, so the app server (not zero-cache) owns business logic.
- `getTraceparent()` — W3C distributed-tracing hook; injects `traceparent` into outbound messages for end-to-end traces client→cache→API. (Observability again treated as first-class.)
- `kvStore` (`mem`/`idb`/custom), `maxHeaderLength`, `slowMaterializeThreshold` (warn on slow views), `queryChangeThrottleMs` (batch query-set changes), `hiddenTabDisconnectDelay`, `disconnectTimeoutMs`, `pingTimeoutMs`.
- `batchViewUpdates(applyViewUpdates)` — integrate a framework's batched-render primitive (React `unstable_batchedUpdates`, Solid `batch`) so a consistent multi-query state transition is one render.
- `context` — an app-supplied value passed into every query/mutator (auth/tenant info).
- Lifecycle callbacks mirror Replicache: `onUpdateNeeded`, `onClientStateNotFound`, `onOnlineChange` (deprecated in favor of `connection.state`).

### Zero takeaways for sssync
1. **Thread a `ResultType` (`unknown`/`complete`/`error`) through every reactive result and hook.** It's the single highest-leverage idea: optimistic UIs need to know whether what they're showing is confirmed, and this makes loading/stale/error states uniform from engine to view tuple.
2. **Two awaitable promises per mutation (`.client` / `.server`).** Cleanly separates "rendered locally" from "accepted by server."
3. **TTL on queries** as the caching primitive — keep syncing recently-used queries for a window so back-navigation is instant; expose `preload` for proactive warming.
4. **Relational subqueries via `related()`** that grow the result type — if sssync grows past KV, this nested-hydration model (each relation independently filterable, the AST serialized to drive sync) is the pattern to study.
5. **Named/synced queries + ZQL-expression permissions** keep the server in control of what clients can read/write — security lives in the schema artifact, not request handlers.
6. **A first-class Inspector and tracing/metrics hooks.** Sync engines are black boxes; structured introspection (active queries, row counts, hydration timing, client-vs-server query form) and distributed-tracing hooks are core features.
7. **Connection lifecycle as a subscribable state machine** with explicit `needs-auth`/`error`/`closed` states and a `connect({auth})` resume method — richer and more honest than a boolean `online`.
8. **Same mutator code, client and server.** `tx.location`/`tx.reason` + a server-only `dbTransaction` let one mutator run optimistically on the client and authoritatively against Postgres — the "shared mutator" model is the core ergonomic win over hand-written push endpoints.
9. **Decouple client names from server/DB names** (`.from()` on tables and columns) so the wire/DB schema can evolve independently of client code.
10. **Pluggable everything**: storage (`kvStore`), transport endpoints/headers, view factories, batch-update integration, log sinks — the core stays small while integration points are explicit.

---

## Part 3 — Zero's server-side & secondary entrypoints

Zero's npm package exposes ~18 entrypoints. Parts 1–2 cover the client (`@rocicorp/zero`, `/react`). The rest is the **server half** — the code you run in *your* API server to apply mutations authoritatively and resolve synced queries — plus DB adapters, framework parity, and tooling. This is half of what makes Zero's "shared mutator" story actually work, so it belongs here.

### `@rocicorp/zero/server` (`zero-server`) — applying writes & resolving queries

The client sends mutations/queries to zero-cache, which forwards them to *your* endpoint. These are the building blocks for that endpoint:

- **`PushProcessor`** — the main entry. `new PushProcessor(dbProvider, context?, logLevel?)` then `processor.process(mutators, request)` (or `(mutators, queryString, body)`). It parses a push request, checks protocol version, and applies each mutation **in order, transactionally**, with explicit semantics: out-of-order → stop + retry; already-applied → skip; **application error → skip that mutation, return the error to the client, keep going**. This is the server counterpart to the optimistic client mutator — the same mutator definitions run here against the real DB.
- **`ZQLDatabase`** — wraps a `DBConnection` + schema and gives mutators a `transaction()` that exposes the ZQL `tx.query`/`tx.mutate` interface *backed by Postgres*. This is the glue that lets one mutator body run both client-side (IVM/optimistic) and server-side (real SQL).
- **Query resolution handlers**: `handleQueryRequest`, `handleGetQueriesRequest`, `handleTransformRequest` (+ `QueryRequestHandler` / `TransformQueryFunction`). These resolve the client's **named/synced queries** server-side — validating args, applying the auth context, and transforming a `{name, args}` request into an authorized AST. This is where server-controlled query security is enforced.
- **`executePostgresQuery`**, `ZQLDatabase`, `makeSchemaCRUD` / `CRUDMutatorFactory` — lower-level pieces.
- **Mutation plumbing types**: `handleMutateRequest`/`handleMutationRequest`, `getMutation`, `OutOfOrderMutation`, `Database`, `TransactFn`, `TransactionProviderHooks/Input`, `MutateResponse`, `QueryResponse`, `ServerSchema`/`ServerTableSchema`/`ServerColumnSchema`.
- **`ApplicationError` / `isApplicationError`** — the typed error a server mutator throws to send a structured, client-visible failure (surfaces in the client's `MutatorResult.server` rejection and the query/mutation error `details`). This closes the loop with the client's `ResultType: 'error'` model.

### DB adapters — `@rocicorp/zero/server/adapters/*`

One adapter per ORM/driver, each a thin `DBConnection`/`DBTransaction` implementation plus a `zeroX(...)` helper:
- `drizzle` (`zeroDrizzle`, `DrizzleConnection`), `kysely` (`zeroKysely`), `prisma` (`zeroPrisma`), `pg` (node-postgres, `zeroNodePg`), `postgresjs` (`zeroPostgresJS`).

The lesson: rather than own the database layer, Zero defines a **minimal `DBConnection`/`DBTransaction` interface** and ships adapters so server mutators run inside the app's existing ORM transaction. `@rocicorp/zero/pg` is a convenience re-export of server + the postgres.js adapter.

### `@rocicorp/zero/zqlite` — ZQL over SQLite

`Database`, `QueryDelegate`, `QueryImpl`, `defaultFormat`. Runs ZQL queries against a local SQLite database (used server-side / in zero-cache, and for running ZQL outside the browser). Confirms ZQL is engineered to run against multiple backends behind the same `Query` surface.

### `@rocicorp/zero/solid` — full framework parity with React

SolidJS bindings mirror the React ones almost 1:1: `ZeroProvider`, `useZero`/`createUseZero`, `createZero`, `useQuery` + idiomatic `createQuery`, `useConnectionState`, `useZeroOnline`, same `QueryResult`/`UseQueryOptions`. Takeaway: the reactive contract (`[data, {type, error, retry}]` tuple, `enabled`/`ttl` options) is framework-agnostic by design, and a second binding is treated as table-stakes.

### `@rocicorp/zero/analyze` & the CLI

- `runAnalyzeCLI(options)` / `AnalyzeCLIOptions` — programmatic query-plan analysis (the `inspector.analyzeQuery` machinery as a CLI), for understanding how a ZQL query will hydrate/execute.
- The package `bin` (`zero/src/cli.ts`) is the **zero-cache server runner** itself — the sync backend process. Schema/permission deployment tooling (`build-schema`, `deploy-permissions`) lives alongside it.

### `@rocicorp/zero/bindings` — the advanced/integration escape hatch

Low-level internals deliberately exported for building *custom* framework integrations or working directly with IVM: `newQuery`/`QueryImpl`/`QueryDelegate`, the IVM `Stream`/`consume`/`skipYields`, `Immutable`, `deepClone`, `addContextToQuery`, `DEFAULT_TTL_MS`. The existence of a documented "here are the guts" entrypoint (separate from the curated main API) is itself a design choice worth noting.

### `change-protocol/v0`

The versioned **change-source protocol** — the wire format zero-cache uses to ingest a change stream from upstream Postgres (logical replication). Public so others can implement change sources. Mirrors Replicache's "publish the wire protocol" philosophy at the ingestion layer.

### Server-side takeaways for sssync
1. **The server half is a first-class, unbundled API**, not a hosted black box: `PushProcessor` + query handlers let you run the authoritative side *inside your own server/transaction*, with explicit per-mutation ordering/idempotency/error semantics.
2. **Define a tiny DB-connection interface and ship adapters** (drizzle/kysely/prisma/pg) instead of owning persistence — server mutators join the app's existing transaction.
3. **Typed `ApplicationError`** flows from a server mutator all the way to the client's `.server` promise and `ResultType:'error'` — one error model end to end.
4. **Named/synced query resolution is a server concern** (`handleTransformRequest`) — the security boundary is explicit and server-owned.
5. **Same query engine, multiple backends** (browser IVM, SQLite, Postgres) behind one `Query` type.
6. **Publish wire protocols at both edges** (client↔cache sync *and* upstream→cache change-source) so the system is reimplementable, not just consumable.

### Honest coverage note
I read the full export list of **every** public entrypoint and drilled into the substantive ones. Curated client + server APIs and their core types are covered in depth. I did **not** exhaustively expand every individual type behind the deep protocol/AST entrypoints (`zero-protocol`'s full AST/message schemas, the complete `change-protocol/v0` message set) — those are large, mostly-mechanical wire-format type unions rather than user-facing ergonomics, so I summarized their purpose rather than enumerating each field.

| Entrypoint | Status |
|---|---|
| `@rocicorp/zero` (client: `Zero`, ZQL, schema, mutators, permissions, inspector, connection) | Read in depth |
| `@rocicorp/zero/react`, `/solid` | Read in depth |
| `@rocicorp/zero/server`, `/pg`, `/server/adapters/*` | Read in depth |
| `@rocicorp/zero/zqlite`, `/analyze`, `/bindings` | Read (surface enumerated) |
| `replicache` (`.`, `/impl`, sqlite entrypoints) | Read in depth |
| `zero-protocol` AST/message schemas, `change-protocol/v0` full message set | Purpose summarized, not field-by-field |

---

*Source checked out (sparse) to a tmp folder from `rocicorp/mono@main`. Packages read: `replicache/src`, `zero/src` (all entrypoints), `zero-client/src`, `zql/src`, `zero-schema/src`, `zero-react/src`, `zero-solid/src`, `zero-permissions/src`, `zero-server/src` (incl. `adapters/*`), `zero-pg/src`, `zqlite/src`, `analyze-query/src`, `zero-types/src`, `zero-protocol/src`.*
