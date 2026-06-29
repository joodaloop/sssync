---
title: 1.0 Roadmap
description: Todo list & progress tracking
---

## Schema
- [x] [Copy over code from Zero Schema so that we can drop that dependency and gain flexibility if needed in the future](https://github.com/joodaloop/sssync/commit/dcffe4bb57ab88fe9d021634e394943c82f6b098)

## ~~Events~~ Mutators

- [x] [Decide on an event schema format](https://github.com/joodaloop/sssync/blob/80360dfddba47bd1c9bb33cabeb7b15798ae4072/website/content/docs/events.md)
- [x] [Build type-safe event definitions, with a Standard Schema `data` field](https://github.com/joodaloop/sssync/commit/15d512c14b0d23aa6c9fd88b18e7811a5b95fd55)
- [x] [Switch over to using mutators instead of the event/projector separation](https://github.com/joodaloop/sssync/commit/8230a567fbeb45c02e03815f82cc5f98ab6c4968)
- [ ] Build log of mutations (optional persistence)

## Query DSL
- [x] [Finalise design for query builder](https://github.com/joodaloop/sssync/commit/3e255be4fd00f77772a3ee91b83d3dd02c0c10e7)
- [ ] Build system for subscriptions
- [ ] Make sure upates to queries are batched before revealing to the UI

## Network requests
- [x] [Build bootstrap lifecycle manager](https://github.com/joodaloop/sssync/commit/fb47175bf0f13d76d9d0c43247ca3a65e3d3f694)
- [x] [Design batch loader that dedupes query satisfactions and validates responses](https://github.com/joodaloop/sssync/commit/a96a3bfef518a3c44f3be8f6470fa5ba5dfa4fbc)

## Store
- [ ] Design APIs to write to the store from:
  - [ ] Mutations
  - [ ] Syncers
  - [x] Batch/bootstrap
- [ ] Build an IndexedDB database management system

## Cross-tab coordination
- [ ] Decide how mutations will be queued and flushed
- [ ] Add a `schema-changed` Broadcast Channel coordinator
- [ ] Add a `store-updated` Broadcast Channel coordinator

## Putting it all together
- [ ] Design error types for library
- [ ] Figure out how to play well with SSR:
  1. Make IDB storage purely pluggable
- [ ] Connect query layer with the coverage tracker
- [x] [Connect the coverage tracker with the batch loader](https://github.com/joodaloop/sssync/commit/54d199d3d9bc435ca532ada96fa653bedccee3fe)
- [ ] Connect batch loader with the store
- [ ] Coordinate the startup sequence (check for database, create if needed)
- [ ] Connect mutations rebasing to store

## Integrations

### Solid.js integration
- [x] [Build a wrapper over the core SSSync class](https://github.com/joodaloop/sssync/commit/2db554f676548bc3fd94bcc6b910b79ee47b4f7f)


## Dead ends

## ~~Projectors~~
- [ ] ~~Figure out a nice projector API that is easy to use across backend and frontend~~
- [ ] ~~Build type-safe projectors that connect **events** and **schema** in a SSSync client~~

## Future

- Go through https://github.com/rocicorp/replicache/releases and implement all useful features.
- Eviction
- Partial migrations
- Give materializers access to the database
- Figure out a syncgroups abstraction (with shared data)
- Add IVM for `where` queries (`store.issues.where(q => q.eq("status", "open"))`) to the query language, with `sorted-btree` for indexing.
  - gte
  - lte
  - eq
  - in
