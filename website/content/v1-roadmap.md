---
title: 1.0 Roadmap
description: Todo list & progress tracking
---

## Schema
- [x] [Copy over code from Zero Schema so that we can drop that dependency and gain flexibility if needed in the future](https://github.com/joodaloop/sssync/commit/dcffe4bb57ab88fe9d021634e394943c82f6b098)
- [x] [Use minimal internal validators instead of Valibot](https://github.com/joodaloop/sssync/commit/952f4623ef2f045b8ee46d9500145bf4743a17ef)

## Mutators
- [x] [Switch over to using mutators instead of the event/projector separation](https://github.com/joodaloop/sssync/commit/8230a567fbeb45c02e03815f82cc5f98ab6c4968)
- [x] [Decide on a mutator design](https://github.com/joodaloop/sssync/blob/80360dfddba47bd1c9bb33cabeb7b15798ae4072/website/content/docs/events.md)
- [x] [Build type-safe mutator definitions, with a Standard Schema `data` field](https://github.com/joodaloop/sssync/commit/15d512c14b0d23aa6c9fd88b18e7811a5b95fd55)
- [ ] Build cross-tab ordering system
- [ ] Connect to IDB for persistence
- [ ] Choose an incrementing Mutation ID format per (client|browser)

## Query DSL
- [x] [Finalise design for query DSL](https://github.com/joodaloop/sssync/commit/3e255be4fd00f77772a3ee91b83d3dd02c0c10e7)
- [ ] Design system for subscriptions
- [ ] Make sure updates to queries are batched before revealing to the UI
- [ ] Add lazy accessor to queries to track just insert/update/delete (like experimental `watch()` API) 

## Network requests
- [x] [Build bootstrap lifecycle manager](https://github.com/joodaloop/sssync/commit/fb47175bf0f13d76d9d0c43247ca3a65e3d3f694)
- [x] [Design batch loader that dedupes query satisfactions and validates responses](https://github.com/joodaloop/sssync/commit/a96a3bfef518a3c44f3be8f6470fa5ba5dfa4fbc)

## Store
- [ ] Design APIs to write to the store from:
  - [ ] Mutations
  - [ ] Syncers
  - [x] [Batch/bootstrap](https://github.com/joodaloop/sssync/commit/068f1bcd36abd5f8bac0887c67458e94988811c5)
- [ ] Implement (tested) performant path for store APIs 
- [ ] Handle the `store-updated` Broadcast Channel coordinator

## SSSync class
- [ ] Design error types for library
- [ ] Handle the `schema-changed` Broadcast Channel coordinator
- [ ] Figure out how to play well with SSR:
  1. Make IDB storage purely pluggable
  2. Guard `BroadcastChannel` messages to only run on client
- [ ] Connect query layer with the coverage tracker
- [x] [Connect bootstrap layer to store](https://github.com/joodaloop/sssync/commit/208bb9e729cbeec807de16a06ce0782234bf3fa5)
- [x] [Connect the coverage tracker with the batch loader](https://github.com/joodaloop/sssync/commit/54d199d3d9bc435ca532ada96fa653bedccee3fe)
- [x] [Connect batch loader with the store](https://github.com/joodaloop/sssync/commit/14e178c136b6ddbfe431a6a00076394d405f57d4)
- [ ] Coordinate the startup sequence (check for database, create if needed)
- [ ] Connect mutations rebasing to store

## Persistence (IDB)
- [ ] Build an IndexedDB database management system (with indexes)
- [ ] Design system for query layer to use
- [ ] Design API for persisting store data
- [ ] Design API for storing and reading coverage indexes & bootstrap status
- [ ] Design API for storing mutation queue

## Integrations
- [ ] Solid.js wrapper with Stores on the reactive layers
- [ ] React wrapper with stable identity

<br/>

## Future
- Add https://rxdb.info/key-compression.html
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

<br/>

## Dead ends

### ~~Events & Projectors~~
- [x] ~~Decide on an event schema format~~
- [ ] ~~Figure out a nice projector API that is easy to use across backend and frontend~~
- [ ] ~~Build type-safe projectors that connect **events** and **schema** in a SSSync client~~
