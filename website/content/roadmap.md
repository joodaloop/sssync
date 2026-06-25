---
title: Roadmap
description: Planned features across Version 1 and Version 2, from events and materializers to IVM where-queries.
---

## Version 1
- Events, with niceties like "deprecate" and suggested versioning schema, enforced by type-safe strings
- Materializers as pure state changes
- Query language of .related() and .single() only
- All data held in memory
- Batch fetches for single items + relations

## Version 2
- Design eviction and partial migration approach
- Turn materializers into arbitrary functions with access to the database (point lookups are fast and can be cached after the first time)
- Figure out a syncgroups abstraction (with shared data)
- Add IVM for `where` queries (`store.issues.where(q => q.eq("status", "open"))`) to the query language, with `sorted-btree` for indexing.
  - gte
  - lte
  - eq
  - in
