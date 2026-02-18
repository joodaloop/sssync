# sssync: Simple Sync for Small apps

## WARNING: THIS IS NOWHERE NEAR DONE

Client-side library that satisifes half of the sssync protocol, made to enable apps where the priorities are:
- offline-first usage
- partial data loading
- simple infrastructure setup (server + database + client)
- pleasant DX, with the basics taken care of

### nice-to-haves
- Undo-redo support
- UI state persistence (with screen width options)
- Design schema management + migration system
- Query lifecycles
- Sync status + metadata
- Devtools with test modes
- Update batching API (for sliders)
- Preloading API
- Event => UI mapping for toasts
- Persistent client-side stores
- Memory usage reduction strategies
- Data seeding
- Simulate bugs through double sending, out of order handling
- Semantic annotation layer to events
- Rewind
- IVM (https://github.com/TanStack/db/tree/main/packages/db-ivm) and query builder API (https://github.com/TanStack/db/tree/main/packages/db/src/query)
