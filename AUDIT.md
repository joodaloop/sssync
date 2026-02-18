# Audit

### High Severity

- **Silent data loss on IDB write failure** (`sssync.ts:105`): `commit()` fire-and-forgets IndexedDB writes. If IDB fails (quota, transaction abort), in-memory state has already mutated but persistence is lost. On next page load, `loadTables()` hydrates from stale IDB and mutations vanish.
- **Lost mutations on leader handoff** (`sssync.ts:96-112`): Non-leader tabs send mutations over BroadcastChannel without writing to IDB. If the leader closes before processing, the message is gone. The new leader has no replay mechanism.
- **Memory/IDB divergence on update of missing rows** (`stores/default.ts:37-39`, `sssync.ts:486-498`): `update` on a missing in-memory row silently no-ops, but `resolveActionValue` writes the partial update to IDB as a new row. On reload, IDB has a partial/malformed row that memory never had.
- **Bricked instance on any validation failure during load** (`sssync.ts:383-394`): `loadTables` parses every row with `v.parse`. One corrupted or schema-mismatched row throws and rejects the `ready` promise permanently. No skip, no migration, no recovery.

### Medium Severity

- **Duplicate rows on replayed creates** (`stores/default.ts:33`): `mutate` with `create` always pushes without checking for existing IDs. Replayed events (BroadcastChannel + local) produce duplicates.

### Low Severity
- **`IndexedDbClient` opens a new connection per operation** (`storage/indexeddb.ts:22-32`): Each method calls `openDB()`. Should cache the connection. Also appears unused by `SSSync` (parallel implementation).
- **BroadcastChannel messages are unvalidated** (`sssync.ts:207-218`): Incoming messages are cast with `as`, no schema validation.
