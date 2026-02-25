# sssync: Simple Sync for Small apps

> A ZQL-based frontend query layer, wrapping SQLite backed by OPFS, kept up to date by a stateless server sync protocol.

- offline-first usage
- partial data loading
- simple infrastructure (serverless server + any database + web client), that can be run cheaply
- pleasant DX, with the basics taken care of

## WARNING: THIS IS NOWHERE NEAR DONE

## Open questions
- Provide both IVM and non-IVM versions?
- Provide both IDB (sync) and SQLite (async) versions?
- Semantics around temporary fetch vs. persist results

### nice-to-haves
- Undo-redo support
- Full-text search
- UI state persistence (with screen width options)
- Design schema management + migration system
- Query lifecycles
- Sync status + metadata + satisfied queries
- Devtools with test modes
- Update batching API (for sliders)
- Preloading API (like Linear?)
- Event => UI mapping for toasts
- Persistent (and typed) client-only stores
- Images handling, like icons (https://colanode.com/blog/emojis-icons-offline-with-sqlite/)
- Data seeding
- Simulate bugs through double sending, out of order handling
- Request delaying to test loading UI
- Semantic annotation layer to events
- Rewind
