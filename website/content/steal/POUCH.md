# PouchDB — public API surface

A rundown of [PouchDB](https://pouchdb.com/api.html)'s public API, from the official API reference. Same goal as the other notes in this repo ([ROCICORP.md](./ROCICORP.md), [TINYBASE.md](./TINYBASE.md), [POWERSYNC.md](./POWERSYNC.md), [ELECTRIC.md](./ELECTRIC.md), [RX.md](./RX.md)): understand what a mature local-first database exposes to users, to inform `sssync`.

PouchDB is the JavaScript implementation of **CouchDB's data model and replication protocol**, designed to run in the browser (IndexedDB), Node (LevelDB), or against a remote CouchDB over HTTP. Its defining characteristics: **every document is a JSON doc with an `_id` and a revision `_rev`**; writes are **MVCC** (multi-version concurrency control — you must supply the current `_rev` to update, and conflicts are first-class, not errors); and **sync is the CouchDB replication protocol** — bidirectional, incremental, checkpoint-based, and able to run against any CouchDB-compatible server with no custom backend code. Every method **returns a Promise and also accepts a Node-style callback**; the streaming methods (`changes`, `replicate`, `sync`) return **event emitters**.

---

## Construction & database management

- **`new PouchDB(name, [options])`** — open or create a database. `name` selects the adapter: a plain string → local (IndexedDB/LevelDB); an `http(s)://` URL → a remote CouchDB. Options: `adapter`, `auto_compaction`, `revs_limit`, `fetch` (custom fetch for auth/headers), `auth`, `skip_setup`.
- **`db.destroy([options], [cb])`** — delete the entire database and its data.
- **`db.close([cb])`** — close handles / free resources without deleting data.
- **`db.info([cb])`** → `{ db_name, doc_count, update_seq, ... }` — database stats.
- **`PouchDB.plugin(plugin)`** — register a plugin (e.g. `pouchdb-find`, `pouchdb-authentication`). The whole ecosystem is plugins.
- **`PouchDB.defaults(options)`** — produce a `PouchDB` subclass with preset defaults (e.g. a fixed adapter or prefix).

---

## Document CRUD (single)

The MVCC contract runs through all of these: reads return a `_rev`; updates must echo the latest `_rev` or fail with a 409 conflict.

- **`db.put(doc, [options], [cb])`** — create or update a document that has an explicit `_id`. To update, `doc._rev` must be the current revision. Returns `{ ok, id, rev }`.
- **`db.post(doc, [options], [cb])`** — create a document with a **server-generated `_id`**. (Discouraged for most data — random ids hurt locality — but available.)
- **`db.get(docId, [options], [cb])`** — fetch one document. Options expose the revision machinery: `rev` (a specific revision), `revs` / `revs_info` (revision history), `open_revs` (all leaf revisions — for conflict inspection), `conflicts` (include `_conflicts` array), `attachments` / `binary`, `latest`.
- **`db.remove(doc | docId, [docRev], [options], [cb])`** — delete a document. Deletion is itself a revision (a "tombstone" with `_deleted: true`) so it replicates like any other change.

### Revisions & conflicts (the data model, not a method)
Every doc carries `_rev` (`N-hash`). Concurrent edits create **conflicting leaf revisions**; PouchDB deterministically picks a "winning" revision but **keeps the losers** (`_conflicts`). Resolving a conflict = read the conflicting revisions, `put` a merged doc, and `remove` the losing revisions. Replication never silently discards data — conflicts are surfaced for the app to resolve. This explicit, app-resolved conflict model is the heart of the CouchDB lineage.

---

## Bulk operations

- **`db.bulkDocs(docs, [options], [cb])`** — create/update/delete many docs in one call (each may carry `_id`/`_rev`/`_deleted`). The primitive replication is built on. With `{ new_edits: false }` it can write **arbitrary revision trees** (used to push history during replication).
- **`db.allDocs([options], [cb])`** — list documents **sorted by `_id`** (the primary index). Options: `include_docs`, `startkey`/`endkey`/`inclusive_end`, `key`/`keys`, `limit`, `skip`, `descending`, `conflicts`, `attachments`. This is the range-scan primitive — id-ordered, cursor-able — and the reason id design matters.
- **`db.bulkGet([options], [cb])`** — fetch many specific `{id, rev}` pairs at once (used by replication; rarely called directly).

---

## Changes feed (reactivity)

- **`db.changes([options])`** → **event emitter** — the reactive core. Emits `change` per document change, then `complete`, plus `error`. Key options:
  - `live: true` — stay open and stream future changes (otherwise one-shot).
  - `since` — start from a sequence (`0`, a seq, or `'now'`); makes it resumable.
  - `include_docs`, `attachments`, `conflicts`, `binary` — shape the payload.
  - `filter` / `doc_ids` / `selector` / `view` / `query_params` — server-or-local filtering of which changes you receive.
  - `descending`, `limit`, `return_docs`, `batch_size`, `seq_interval`, `timeout`, `heartbeat`.
  - Returns an object with `.cancel()` to stop.

The `changes` feed is the universal substrate: replication, live queries, and UI reactivity all consume it. There is no per-field or per-query reactivity primitive — you watch the change log and react.

---

## Replication & sync (the CouchDB protocol)

This is PouchDB's headline capability: **replicate to/from any CouchDB-compatible endpoint with no custom server code.**

- **`PouchDB.replicate(source, target, [options])`** / **`db.replicate.to(remote, [options])`** / **`db.replicate.from(remote, [options])`** — one-way replication, returns an **event emitter**: `change` (a batch replicated, with `docs`, `docs_written`, `last_seq`), `paused`/`active` (idle vs working, e.g. offline), `denied` (a doc rejected by server auth), `complete`, `error`. `.cancel()` stops it.
- **`db.sync(remote, [options])`** = `replicate.to` + `replicate.from` together; change events carry a `direction` (`'push'`/`'pull'`).

Options: `live` (ongoing realtime vs one-shot), `retry` (auto-reconnect with backoff on failure/offline), `since`, `batch_size`, `batches_limit`, `back_off_function`, `checkpoint` (`'source'`/`'target'`/`false` — where to persist progress), `style`, `timeout`, `heartbeat`, and the same filtering set as `changes`: `filter`, `doc_ids`, `query_params`, `view`, `selector`.

How it works (the part worth internalizing): replication is **checkpoint-based and incremental** — it reads the source `changes` feed since the last checkpoint, calls **`db.revsDiff`** on the target to learn which revisions are missing, ships only those via `bulkGet`/`bulkDocs`, and writes a **checkpoint** so it can resume exactly where it left off after offline/reload. No central coordinator, no per-client server state — any two databases can replicate.

- **`db.revsDiff(diff, [cb])`** — given `{ docId: [revs] }`, return which revisions the database is missing. The core replication primitive, exposed publicly.

---

## Attachments (binary data)

- **`db.putAttachment(docId, attachmentId, [rev], blobOrBuffer, contentType, [cb])`** — attach binary data to a document.
- **`db.getAttachment(docId, attachmentId, [options], [cb])`** → Blob (browser) / Buffer (Node).
- **`db.removeAttachment(docId, attachmentId, rev, [cb])`**.

Attachments live on documents and **replicate with them**, with content-type metadata — binary sync is first-class, not a side channel.

---

## Querying

### Map/reduce views (the original CouchDB way)
- **`db.query(fun, [options], [cb])`** — run a map/reduce query. `fun` is a map function (or a `'designDoc/viewName'` string referencing a persisted view, or `{ map, reduce }`). Options: `reduce`, `group`, `group_level`, `key`/`keys`, `startkey`/`endkey`/`inclusive_end`, `limit`/`skip`, `descending`, `include_docs`, `stale`/`update_seq`. Persisted views are incrementally maintained on disk.
- **`db.viewCleanup([cb])`** — remove obsolete view indexes.

### Mango queries (`pouchdb-find` plugin)
A more familiar declarative query layer:
- **`db.createIndex({ index: { fields, partial_filter_selector? }, name?, ddoc? }, [cb])`** — create a secondary index.
- **`db.find({ selector, fields?, sort?, limit?, skip?, use_index? }, [cb])`** — query by a MongoDB-style `selector`. Returns `{ docs }`.
- **`db.explain(request, [cb])`** — return the query plan (which index would be used).
- **`db.getIndexes([cb])`** — list indexes (plus the built-in `_all_docs`).
- **`db.deleteIndex(index, [cb])`** — drop an index and clean its design doc.

`find` is **not inherently reactive** — to make a Mango query live you re-run it on `changes` events (or use the `pouchdb-live-find` plugin). Reactivity is always layered on the change feed.

---

## Maintenance & lifecycle

- **`db.compact([options], [cb])`** — reclaim space by discarding old non-leaf revisions (with `auto_compaction` it happens continuously).
- **`db.purge(docId, rev, [cb])`** — permanently remove specific revisions from local history (rare; breaks replication assumptions if misused).
- **`db.viewCleanup`**, `db.revsDiff` (above).
- **`db.on(event, handler)`** — database-level events: `created`, `destroyed`, plus the streaming events surfaced by `changes`/`replicate`/`sync` (`change`, `complete`, `error`, `paused`, `active`, `denied`, `indexing`, `checkpoint`).

---

## The shape of the whole surface

A small, stable, document-oriented core:
- **CRUD by `_id` + `_rev`** (`put`/`post`/`get`/`remove`), with MVCC and explicit conflicts.
- **Bulk + id-ordered range scan** (`bulkDocs`/`allDocs`) as the storage primitives.
- **One reactive primitive**: the `changes` feed (`live`, `since`, filters), which everything else (replication, live queries) consumes.
- **Replication/sync as the CouchDB protocol** (`replicate`/`sync` + `revsDiff` + checkpoints) — peer-to-peer-capable, resumable, backend-agnostic against any CouchDB.
- **Two query layers**: low-level incremental map/reduce views, and a Mango `find`/`createIndex` plugin.
- **First-class binary attachments** that replicate with documents.
- **Plugin-extensible** (`PouchDB.plugin`) — find, auth, live-find, etc. are all add-ons.

### Transplantable ideas for sssync
1. **MVCC with explicit, non-lossy conflicts.** Requiring `_rev` on writes and *keeping* conflicting revisions (`_conflicts`) rather than silently merging means replication never loses data and the app owns resolution. The opposite of auto-LWW; honest about divergence.
2. **One reactive primitive — a resumable change feed.** `changes({ live, since, filter })` with a `since` cursor and `.cancel()` is the entire reactivity story; live queries are just re-runs triggered by it. Simple, and `since` makes it resumable across reloads/offline.
3. **`revsDiff` + checkpoints as the replication core.** "Tell me which revisions you're missing, ship only those, write a checkpoint" is a clean, resumable, coordinator-free sync algorithm that works peer-to-peer. The checkpoint is the whole resume-state (echoing Electric's `offset` and RxDB's checkpoint).
4. **`bulkDocs` with `{ new_edits: false }`** — one write path that can either make new edits *or* import arbitrary revision history. The same primitive serves user writes and replication.
5. **id-ordered `allDocs` range scan** as the read primitive — prefix/`startkey`/`endkey`/`limit`/`descending` over sorted ids gives pagination and range queries without a query engine (and makes id design a deliberate locality decision).
6. **Backend-agnostic sync via a published protocol.** Because replication is the documented CouchDB protocol, any compatible server (or another PouchDB) just works — no bespoke push/pull endpoint per app. The protocol, not a product, is the integration point.
7. **Attachments that replicate with their document**, carrying content-type — binary as a first-class, sync-aware citizen.
8. **Promise-or-callback + event-emitter duality**, and a tiny plugin-extensible core — keep the baseline minimal and push find/auth/etc. into optional plugins.

The throughline: PouchDB is a **document database whose entire identity is the CouchDB replication protocol** — MVCC documents, explicit conflicts, a resumable change feed, and `revsDiff`-driven incremental sync that runs against any compatible peer with zero custom backend. For sssync, its most useful lessons are the *honesty about conflicts* (keep the losers, let the app resolve) and the *minimalism of the sync core* (a change feed + a "what are you missing?" diff + a checkpoint).

---

*Source: the official PouchDB API reference at https://pouchdb.com/api.html (the canonical, complete listing of the public method surface). Method signatures, options objects, and return types (Promise / callback / event emitter) are as documented there.*
