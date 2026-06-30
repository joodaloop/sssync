# Learning from RxDB

A study of [RxDB](https://rxdb.info/)'s public API, read from source (`pubkey/rxdb@main`, `src/` + `src/types`). Same goal as [LEARN.md](./LEARN.md) (Replicache/Zero), [TINYBASE.md](./TINYBASE.md), [POWERSYNC.md](./POWERSYNC.md), and [ELECTRIC.md](./ELECTRIC.md): understand what a mature local-first database decided its users needed, to inform `sssync`.

RxDB ("Reactive Database") is the **oldest and most batteries-included** of the systems studied — a full client-side NoSQL document database whose defining traits are: **everything is an RxJS `Observable`** (queries, documents, even individual fields emit), a **MongoDB-style query language (Mango)**, a **pluggable storage engine** abstraction underneath, and a **generic, transport-agnostic replication protocol** on top. Where Electric is "just a change-log" and TinyBase is "just a reactive store," RxDB is the maximalist: schema + ORM + reactive queries + migrations + attachments + encryption + conflict handling + a dozen replication backends, all assembled from plugins.

Its central bet: **make the local database fully reactive (RxJS down to the field level) and make sync a pluggable protocol you point at any backend.** Two design pillars worth internalizing before the details:
1. **The storage engine is an interface (`RxStorage`), not a fixed implementation.** IndexedDB, SQLite, in-memory, Dexie, FoundationDB, Mongo, or a remote storage over a worker — all swappable behind one contract. RxDB itself is the reactive/query/sync layer *on top of* a simple bulk-write + query + changeStream storage primitive.
2. **Replication is one generic protocol with pull/push handlers you implement** — GraphQL, REST, CouchDB, Firestore, Supabase, WebRTC (P2P), etc. are all thin adapters over the same core.

---

## The object model

`RxDatabase → RxCollection → RxDocument`, with `RxQuery` as the reactive query handle and `RxSchema` (JSON Schema) defining each collection. You create a database, add collections (each with a schema), and get back ORM-style document objects.

```ts
const db = await createRxDatabase({ name, storage: getRxStorageDexie() });
await db.addCollections({ todos: { schema: todoSchema } });
const sub = db.todos.find({ selector: { done: false } }).$.subscribe(docs => render(docs));
await db.todos.insert({ id, text, done: false });
```

The thing that makes RxDB *RxDB*: that `.$` — almost every read returns an Observable that re-emits whenever the underlying data changes. Reactivity is the default, not an opt-in.

---

## Part 1 — `RxDatabase`

`createRxDatabase(options)` → `RxDatabase`. Construction options reveal the priorities: `storage` (the pluggable engine, **required**), `name`, `password` (whole-db encryption), `multiInstance` (cross-tab coordination), `eventReduce` (a query-optimization engine, below), `cleanupPolicy`, `closeDuplicates`, `localDocuments`, `hashFunction`, `allowSlowCount`, `reactivity` (plug in a non-RxJS reactivity system — Signals/Vue refs).

Methods:
- `addCollections({ name: { schema, methods?, statics?, migrationStrategies?, autoMigrate?, conflictHandler?, ... } })` — define collections with ORM methods, static methods, migration strategies, and a per-collection conflict handler.
- `removeCollectionDoc`, `remove()` (wipe), `close()`.
- `$` — Observable of **all** change events across the database.
- `exportJSON()` / `importJSON()` — full dump/restore (json-dump plugin).
- `backup(options)` → `RxBackupState` — ongoing backup to disk (electron/node).
- `addState(name)` → `RxState` — a reactive, persisted, observable key-value state object (app/UI state lane, like TinyBase's `Values`).
- `waitForLeadership()` / `leaderElector()` — **cross-tab leader election** (multi-tab apps elect one tab to own replication; the leader-election plugin).
- `requestIdlePromise()`, `migrationStates()`.

---

## Part 2 — `RxCollection` (the workhorse)

### Writes (lots of variants — the granularity is the point)
- `insert(data)`, `insertIfNotExists(data)`, `bulkInsert(docs[])`.
- `upsert(data)`, `bulkUpsert(docs[])`, `incrementalUpsert(data)`.
- `bulkRemove(ids[])`.
- `insertCRDT(updateObj)` — CRDT-style write (crdt plugin).

The `incremental*` family is a recurring RxDB idea: **queued, retry-safe writes that re-apply a mutation function against the latest document state** (so concurrent writes don't clobber — closer to an atomic read-modify-write than a blind overwrite).

### Reads — Mango queries returning Observables
- `find(MangoQuery)` → `RxQuery` (array result).
- `findOne(id | MangoQuery)` → `RxQuery` (single).
- `findByIds(ids[])` → `RxQuery` (returns a `Map`).
- `count(MangoQuery)` → `RxQuery` (number; `allowSlowCount` gates non-indexed counts).

A `MangoQuery` is MongoDB-shaped: `{ selector, sort, skip, limit, index }`, where `selector` supports `$eq/$gt/$gte/$lt/$lte/$ne/$in/$nin/$regex/$exists/$type/$mod/$not/$size/$elemMatch/$and/$or/$nor`. The optional `index` hint lets you steer the query planner.

### Reactive change streams
- `$` — all change events; `insert$` / `update$` / `remove$` — filtered streams; `eventBulks$`, `checkpoint$`.

### Hooks (middleware)
`preInsert`/`postInsert`, `preSave`/`postSave`, `preRemove`/`postRemove`, `postCreate` — sync or async (`parallel` flag), per collection. This is where validation, denormalization, audit logging, etc. plug in. `postCreate` runs on every document instantiation (non-async) — used to attach computed/derived getters.

### Lifecycle & misc
- `exportJSON()` / collection-level dump.
- Migrations: `migrationNeeded()`, `startMigration(batchSize)`, `getMigrationState()`, `migratePromise()`.
- `cleanup(minDeletedTime)` — purge tombstones of deleted docs.
- `addPipeline(options)` → `RxPipeline` — **a derived/transform pipeline** that reacts to changes in this collection and writes into another (materialized-view / ETL between collections; the pipeline plugin).
- `addHook`, `close()`, `remove()`.

---

## Part 3 — `RxDocument` (reactive ORM objects)

A document isn't a plain object — it's a live, immutable-by-default proxy with a rich mutation + reactivity surface:

### Reactive fields (the standout feature)
- `doc.$` — Observable of the whole document; re-emits on any change.
- `doc.<field>$` — **per-field Observables**. For a `title` field, `doc.title$` is an `Observable<string>`. The type system generates these (`${P}$`) for every property. Field-level reactivity is unusual and very ergonomic for forms/bindings.
- `doc.$$` / `doc.<field>$$` — the same, but in your chosen **custom reactivity system** (Signals/Vue refs/Angular) via the `reactivity` factory.
- `doc.deleted$`, `doc.allAttachments$`.

### Reads
- `get(path)` (deep, returns `DeepReadonly`), property getters, `populate(path)` — **follow a foreign-key reference to another collection's document** (relational-ish navigation declared via `ref` in the schema).
- `getLatest()` — the freshest version of this doc instance.
- `toJSON()` / `toMutableJSON()`.

### Writes (immutable → produce a new revision)
- `modify(fn)` / `incrementalModify(fn)` — mutate via a function of current state.
- `patch(partial)` / `incrementalPatch(partial)` — shallow merge.
- `update(mongoUpdateQuery)` / `incrementalUpdate(...)` — MongoDB update operators (`$set/$inc/...`, update plugin).
- `updateCRDT(...)` — CRDT write.
- `remove()` / `incrementalRemove()`.

The `incremental*` variants again: serialized, retry-safe writes that re-run against the latest revision — RxDB's answer to concurrent edits without locking. Documents are immutable; every write yields a new revision (the basis of replication + conflict detection).

### Attachments
`putAttachment` / `putAttachmentBase64` / `putAttachments`, `getAttachment(id)`, `allAttachments()` — **binary blobs stored alongside documents**, optionally compressed (attachments-compression) and replicated. Like PowerSync, RxDB treats large-file storage as first-class (most others punt).

---

## Part 4 — `RxQuery` (chainable + reactive)

`find()` returns an `RxQuery` that is both awaitable and observable:
- `.exec()` → `Promise<results>` (one-shot).
- `.$` → `Observable<results>` (live; re-runs on relevant changes).
- `.$$` → the same in your custom reactivity system.
- **Chainable query-builder** (query-builder plugin): `.where(field).eq(v)`, `.gt/.gte/.lt/.lte/.ne/.in/.nin/.regex/.or/.and/.nor/.all`, `.sort()`, `.skip()`, `.limit()` — a fluent alternative to writing the Mango object directly.
- **Bulk mutations over a query result**: `.remove()`, `.update(updateObj)`, `.patch(partial)`, `.incrementalPatch(...)`, `.incrementalRemove()` — apply a write to *every* matching document.

### EventReduce — the query-optimization engine
RxDB's notable internal trick (`eventReduce: true`): when a write happens, instead of re-running every live query against storage, RxDB uses the [event-reduce](https://github.com/pubkey/event-reduce) algorithm to **compute the new result of each open query incrementally from the change event alone** — figuring out whether the changed doc enters/leaves/reorders within each query's result set without touching the database. This is IVM-by-another-name (like Zero's materialize / PowerSync's differentialWatch), built into the reactive query layer so that `query.$` updates are cheap even with many live subscriptions.

---

## Part 5 — Schema (`RxJsonSchema`)

Plain JSON Schema with RxDB extensions:
- `version` (integer — drives migrations), `primaryKey` (a field or a **composite** `{ key, fields, separator }`), `type: 'object'`, `properties`, `required`.
- `indexes` (incl. **compound** `[['a','b']]`), `internalIndexes`.
- `encrypted: [fields]` — per-field encryption (encryption-crypto-js plugin).
- `keyCompression: true` — store short keys on disk, expand in memory (key-compression plugin; meaningful at scale).
- `attachments`, `additionalProperties: false`.
- `ref` on a property — declares a relation to another collection (powers `doc.populate(path)`).

Schemas are **required and versioned** — every schema change bumps `version` and you supply `migrationStrategies` to transform old documents forward. Validation is itself a plugin (`validate-ajv` / `validate-z-schema` / `validate-is-my-json-valid`), so production builds can drop validation for size/speed. This "schema is mandatory, validation is optional/pluggable, migration is first-class" stance is distinct from the looser schemas of TinyBase/Electric.

---

## Part 6 — Replication (the sync core)

RxDB's sync is **one generic protocol**, `replicateRxCollection(ReplicationOptions)`, that everything else adapts to. The options:
- `replicationIdentifier` — stable id so replication **resumes across reloads** (recommended to embed the server URL).
- `pull?: { handler, stream$?, batchSize?, modifier?, initialCheckpoint? }` — `handler(checkpoint, batchSize)` fetches the next batch of remote changes since a **checkpoint**; `stream$` is an Observable the backend pushes realtime changes/`'RESYNC'` through; `modifier` transforms incoming docs.
- `push?: { handler, modifier?, batchSize?, initialCheckpoint? }` — `handler(changeRows)` sends local writes upstream (each row carries `assumedMasterState` + `newDocumentState` for conflict detection).
- `live` (ongoing vs one-shot), `retryTime` (backoff, skipped on `navigator.onLine` transition), `waitForLeadership` (only the leader tab replicates), `autoStart`, `deletedField`.

The returned `RxReplicationState`:
- `start()` / `cancel()` / `reSync()` / `remove()`.
- `awaitInitialReplication()` — resolves once first sync completes (the "don't show UI until synced" primitive).
- `awaitInSync()` — resolves when local == remote right now.
- `error$`, `active$`, `received$`, `sent$`, `canceled` — observable replication telemetry.

### The checkpoint + conflict model
The protocol is **checkpoint-based**: pull/push exchange opaque `CheckpointType` markers (like Electric's offset / Replicache's cookie) so each side knows where it left off. Conflict resolution is a **per-collection `RxConflictHandler`**:
```ts
{
  isEqual(a, b, context): boolean,                // fast equality (called constantly)
  resolve({ assumedMasterState, realMasterState, newDocumentState }, context)
    : Promise<{ isEqual: true } | { isEqual: false, documentData }>
}
```
When a push detects the master moved since the client's `assumedMasterState`, `resolve` is called with both states to produce a merged result. Default is last-write-wins by revision, but you supply domain logic (field merges, etc.). This is **app-defined conflict resolution as a pure function** — more explicit than CRDT auto-merge, more flexible than Zero's server-authoritative rebase.

### Replication backends (plugins)
`replication-graphql`, `replication-couchdb`, `replication-firestore`, `replication-supabase`, `replication-appwrite`, `replication-nats`, `replication-mongodb`, `replication-websocket`, **`replication-webrtc`** (P2P, no server), `replication-google-drive`, `replication-microsoft-onedrive`. All are ~thin adapters supplying `pull.handler`/`push.handler`/`stream$`. The lesson: **define the protocol once; backends are adapters.**

---

## Part 7 — The plugin architecture & storage abstraction

RxDB is a small core + ~40 plugins (`addRxPlugin(plugin)`). This is the whole philosophy: pay only for what you import.

### Storage engines (`RxStorage`)
The storage interface is tiny — an `RxStorageInstance` only needs `bulkWrite`, `query`, `count`, `findDocumentsById`, `getAttachmentData`, `changeStream()` (Observable), `cleanup`, `close`, `remove`. RxDB builds *everything reactive* on top of that `changeStream`. Implementations: `storage-dexie` (IndexedDB), `storage-sqlite`, `storage-memory`, `storage-localstorage`, `storage-denokv`, `storage-foundationdb`, `storage-mongodb`, and **`storage-remote` / `storage-remote-websocket`** (run storage in a Web Worker / another process and talk to it over a message channel — so the main thread stays responsive). The fact that a storage engine only needs bulk-write + query + a change-stream is a strong, minimal contract worth copying.

### Other notable plugins
- `crdt` — opt-in CRDT documents (`updateCRDT`/`insertCRDT`) for automatic conflict-free merges, layered on the same replication.
- `local-documents` — un-synced, un-indexed local KV docs attached to a db/collection (settings/UI state).
- `state` — the reactive `RxState` object (`addState`).
- `cleanup`, `migration-schema` / `migration-storage`, `backup`, `key-compression`, `encryption-crypto-js`, `attachments` / `attachments-compression`, `leader-election`, `query-builder`, `update`, `pipeline`, `vector` (vector search / embeddings), `dev-mode` (heavy runtime validation + helpful errors in dev only), `webmcp` (expose the db to an MCP/agent).
- Framework reactivity adapters: `reactivity-vue`, `reactivity-preact-signals`, `reactivity-angular` — feed the `$$` variants. Plus a `react` plugin: `useRxDatabase`, `useRxCollection`, `useRxQuery` / `useLiveRxQuery`, `useRxDocument`, `useReplicationStatus`.

---

## What RxDB thought users needed

### Transplantable ideas for sssync
1. **Field-level reactivity** (`doc.field$`), not just row/query-level. For form-heavy UIs, an Observable per field is dramatically more ergonomic than re-rendering whole rows. The type system auto-generates the `$` properties.
2. **A pluggable storage contract that's tiny**: `bulkWrite` + `query` + `count` + `findById` + `changeStream()` + `cleanup`/`close`/`remove`. If your reactive/sync layers consume only a `changeStream`, you can swap IndexedDB ↔ SQLite ↔ in-memory ↔ a worker-hosted remote store without touching the rest. The **`storage-remote`** idea (run the DB in a Web Worker, talk over a channel) is a clean way to keep the main thread free.
3. **One generic replication protocol with pull/push handlers + a checkpoint**, and ship backends as thin adapters (REST/GraphQL/WebRTC/…). Don't bake in a transport. The `pull.handler(checkpoint, batchSize)` + `pull.stream$` + `push.handler(changeRows)` triad is a proven, minimal shape, and `replicationIdentifier` for resume-across-reload is the same two-string-state lesson Electric teaches.
4. **Conflict resolution as a per-collection pure function** (`{ isEqual, resolve }`) given `assumedMasterState`/`realMasterState`/`newDocumentState`. More flexible than auto-CRDT, more honest than hiding conflicts. Lets each collection pick its own policy (LWW, field-merge, domain rules).
5. **`incremental*` writes** — queue mutations and re-apply them against the latest revision so concurrent edits don't clobber. A lightweight alternative to transactions/locking for the common "bump a counter / toggle a flag" case.
6. **event-reduce-style incremental query maintenance** — compute each live query's new result from the change event alone, without re-querying storage. The cheap way to support many simultaneous live queries (RxDB, Zero, PowerSync all reinvent this; it's clearly load-bearing).
7. **Versioned schemas with first-class migrations** (`version` + `migrationStrategies` + `startMigration`/`migrationState`). Local-first apps *will* ship schema changes to clients holding old data; making migration a core, observable process (not an afterthought) matters.
8. **Pluggable reactivity** (`$$` + a `reactivity` factory) so the same store drives RxJS, Signals, Vue refs, or Angular without the core depending on any of them. Decouples the data layer from the UI framework's reactivity primitive.
9. **Leader election for multi-tab** so only one tab runs replication (saves connections/bandwidth) while all tabs share the local store — RxDB's answer to the same problem PowerSync solves with a SharedWorker.
10. **Plugin-everything core.** Validation, encryption, key-compression, attachments, backup, dev-mode checks, CRDT, query-builder — all optional imports. Keeps the baseline bundle small while supporting maximalist apps. (Trade-off: a sprawling API surface and more configuration than Electric's or TinyBase's tight cores.)

### The philosophical placement
RxDB is the **"full reactive database, sync is a pluggable protocol"** maximalist. It owns the most of any system here — store, ORM, queries, reactivity, schema, migrations, conflicts, attachments — and externalizes only the *transport* (storage engine + replication backend) behind interfaces. Compared to the others: Electric owns almost nothing (just the change-log); PowerSync owns the SQLite store but not the upload; Zero owns the sync + query engine but mandates its server; TinyBase owns a reactive store but punts on real persistence/queries. RxDB owns all of it and makes the *integration points* (storage, replication, reactivity, validation) the plugin seams. For sssync the question it sharpens: **how reactive, and at what granularity?** RxDB's answer — Observables everywhere, including per-field, with an incremental engine (event-reduce) to make that affordable — is the far end of the reactivity spectrum, and the most directly relevant precedent if sssync wants live queries as the default rather than the exception.

---

*Source: `pubkey/rxdb@main` cloned to a tmp folder. Public API read from `src/types/*.d.ts` (`RxDatabase`, `RxCollection`, `RxDocument`, `RxQuery`/`MangoQuery`, `RxJsonSchema`, `RxStorageInstance`, `conflict-handling`, `replication.d.ts`/`replication-protocol.d.ts`) and the implementations in `src/rx-database.ts`, `src/rx-collection.ts`, `src/rx-query.ts`, `src/plugins/replication/index.ts`. Plugin and storage/replication backend lists enumerated from `src/plugins/`.*
