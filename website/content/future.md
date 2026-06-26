---
title: Future Ideas
description: Long-term plans
---

- Eviction
- Partial migrations
- Give materializers access to the database
- Figure out a syncgroups abstraction (with shared data)
- Add IVM for `where` queries (`store.issues.where(q => q.eq("status", "open"))`) to the query language, with `sorted-btree` for indexing.
  - gte
  - lte
  - eq
  - in
