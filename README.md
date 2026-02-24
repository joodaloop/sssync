# sssync: Simple Sync for Small apps

> A frontend query engine, and stateless server sync protocol.

## WARNING: THIS IS NOWHERE NEAR DONE

Client-side library that satisifes half of the sssync protocol, made to enable apps where the priorities are:
- offline-first usage
- partial data loading
- simple infrastructure setup (server + database + client)
- pleasant DX, with the basics taken care of

## Open questions
- Use TanstackDB Query-based collections for data loading wrapped in our own caching?
- Use SQLite (with indexes?) + OPFS for persistence?
  - https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite
  - https://www.powersync.com/blog/sqlite-persistence-on-the-web
  - https://github.com/TanStack/db/issues/865
- Provide both IVM and non-IVM versions?
- Provide both IDB (sync) and SQLite (async) versions?
- Semantics around temporary fetch vs. persist results
- Write our own mini-IVM that is Solid-first?

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
- Persistent (and typed) client-side stores
- Data seeding
- Simulate bugs through double sending, out of order handling
- Semantic annotation layer to events
- Rewind
- An API like `post.comments().last(10).sort(() => a.text.length > b.text.length);`, which i would honestly much prefer to JOINs, and is what Linear does anyway. Would require an ORM though...
