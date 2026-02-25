# TODO

## Build
- Design sssync.query() API with "temp" option for garbage collection
- Make the sync paths work with Websockets too, by making it pluggable somehow?
- Make sure mutations are batched in all stores, to provide transactional behaviour.
- Design strategies for the query caching layer
- Separate implementation and interface: https://tantaman.com/2022-04-07-your-package-is-two.html
- Use https://detail.dev/, maybe
- No need for web locks for event ordering. just apply, write to indexeddb, and notify other tabs to rescan (or maybe not https://github.com/TanStack/db/issues/865#issuecomment-3873495126 ?)
- Make sure our outbox is as good as https://github.com/TanStack/db/tree/main/packages/offline-transactions
- How do we support incognito mode usage? 


## Questions
- server can return cache_bust: timestamp to hard reset any queries that might have had a bug?
- minimum_version number to stop syncs: old clients shouldn't receive new data. look at what Replicache scheamVersion is used for
