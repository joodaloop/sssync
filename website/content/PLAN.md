## Version 1
- Events, with niceties like "deprecate" and suggested versioning schema, enforced by type-safe strings
- Materializers, with access to the database (point lookups are fast and can be cached after the first time)
- Query language of .related() and .single() only
- All data held in memory
- Use IndexedDB for storage with debounced writes
- Batch fetches for single items + relations

## Version 2
- Design eviction and partial migration approach
- Add IVM for `where` queries (`store.issues.where(q => q.eq("status", "open"))`) to the query language, with `sorted-btree` for indexing.
  - gte
  - lte
  - eq
  - in
