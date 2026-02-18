# sssync: Simple Sync for Small apps

## WARNING: THIS IS NOWHERE NEAR DONE

Client-side library that satisifes half of the sssync protocol (defined below), made to enable apps where the priorities are:
- offline-first usage
- partial data loading
- simple infrastructure setup (server + database + client)
- pleasant DX, with the basics taken care of

### Protocol
- All writes are done though semantic, versioned events.
- Reads are done through a combination of fetch() calls and implementing a log of changes that the client can subscribe to.

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
