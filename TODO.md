## TODO
- Design strategies for the query caching layer
- Separate in-memory store into pluggable version (so it can be a Solid store, legend-state list, etc)
- Use https://detail.dev/, maybe
- no need for web locks for event ordering. just apply, write to indexeddb, and notify other tabs to rescan
- only leader elect for sync
- make sure our outbox is as good as https://github.com/TanStack/db/tree/main/packages/offline-transactions
