## Project Overview

sssync is a lightweight client-side sync library built for small, offline-first apps. It stores materialized tables in IndexedDB, validates event payloads and query responses with valibot, and offers a minimal API centered on a single `SSSync` client instance.

## Current Capabilities

- Defines events with schemas and optional dedupe logic.
- Applies materializers to update in-memory tables and persists them.
- Logs mutations locally for eventual sync.
- Coordinates cross-tab mutation persistence via a leader election on the Web Locks API and BroadcastChannel.
- Fetches and caches query responses, validating them against a SyncResponse schema.

## Next Steps

- Add a reactive store integration layer (Solid store, legend-state, etc.).
- Design better query cache strategies (invalidation, TTL tuning, stale-while-revalidate).
- Formalize the server-side protocol and tooling.
