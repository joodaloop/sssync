# TODO

## Sync
- Design sssync.query() API with "temp" option for garbage collection
- Make the sync paths work with Websockets too, by making it pluggable somehow?
- Make sure mutations are batched in all stores, to provide transactional behaviour.
- Design strategies for the query caching layer
- Separate implementation and interface: https://tantaman.com/2022-04-07-your-package-is-two.html
- Use https://detail.dev/, maybe
- No need for web locks for event ordering. just apply, write to indexeddb, and notify other tabs to rescan (or maybe not https://github.com/TanStack/db/issues/865#issuecomment-3873495126 ?)
- Make sure our outbox is as good as https://github.com/TanStack/db/tree/main/packages/offline-transactions
- How do we support incognito mode usage? 
- server can return cache_bust: timestamp to hard reset any queries that might have had a bug?
- minimum_version number to stop syncs: old clients shouldn't receive new data. look at what Replicache scheamVersion is used for

## IndexedDB

## IVM
Batched transactions — Wrap seed() (and future multi-row CRUD) in a transaction boundary
 that pushes N changes then fires a single commit. This is the lowest-effort, highest-impact
  change.

 CRUD → IVM bridge — After writing to SQLite in insert/update/remove, push the corresponding
  SourceChange into the IVM pipeline so reactive views update immediately. This closes the
 loop between mutations and queries.

 Subscription hydration ordering — subscribeChanges needs to await hydration before wiring
 up the sink, or the sink needs to replay hydrated data when it arrives. Otherwise
 subscriptions created before hydration is complete will miss initial data.

 Optimistic mutations — Push changes into IVM immediately (for instant UI), write to SQLite
 in the background, and roll back the IVM change if the write fails. This is the natural
 next step once the CRUD→IVM bridge exists.

 limit/offset passthrough — Wire through ast.limit in zqlToSQL so you don't over-fetch from
 SQLite.

## SQLite
