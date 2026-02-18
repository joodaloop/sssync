# sssync: Simple Sync for Small apps

Client-side library that satisifes half of the sssync protocol (defined below), made to enable apps where the priorities are:
- offline-first usage
- partial data loading
- simple infrastructure setup (server + database + client)
- pleasant DX, with the basics taken care of

### Protocol
- All writes are done though semantic, versioned events.
- Reads are done through a combination of fetch() calls and implementing a log of changes that the client can subscribe to.

## TODO
- Design strategies for the query caching layer
- Separate in-memory store into pluggable version (so it can be a Solid store, legend-state list, etc)
- Use https://detail.dev/, maybe

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

## Development guide
- Clone the repository, run bun install in root, and also inside /app
- In /app use `bun run dev` to get the test web app running
