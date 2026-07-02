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
- [ ] Connect mutations rebasing to store

## Queries
- [x] [Finalise design for query DSL](https://github.com/joodaloop/sssync/commit/3e255be4fd00f77772a3ee91b83d3dd02c0c10e7)
- [ ] Design system for subscriptions
- [ ] Make sure updates to queries are batched before revealing to the UI
- [ ] Add lazy accessor to queries to track just insert/update/delete (like experimental `watch()` API) 
- [ ] Connect query layer with the coverage tracker

## Batcher
- [x] [Connect batch loader with the store](https://github.com/joodaloop/sssync/commit/14e178c136b6ddbfe431a6a00076394d405f57d4)
- [x] [Design batch loader that dedupes query satisfactions and validates responses](https://github.com/joodaloop/sssync/commit/a96a3bfef518a3c44f3be8f6470fa5ba5dfa4fbc)
- [x] [Connect the coverage tracker with the batch loader](https://github.com/joodaloop/sssync/commit/54d199d3d9bc435ca532ada96fa653bedccee3fe)

## Bootstrap
- [x] [Handle the `bootstraps` Broadcast Channel updates](https://github.com/joodaloop/sssync/commit/74e8d6d3b1781efca79094acb81996f080b83b61)
- [x] [Build bootstrap lifecycle manager](https://github.com/joodaloop/sssync/commit/fb47175bf0f13d76d9d0c43247ca3a65e3d3f694)
- [x] [Connect bootstrap layer to store](https://github.com/joodaloop/sssync/commit/208bb9e729cbeec807de16a06ce0782234bf3fa5)
- [x] Persist and load BoostrapStatus(es) from IDB
- [x] Expose BoostrapStatus as an Observable

## Store
- [ ] Design APIs to write to the store from:
  - [ ] Mutations
  - [ ] Syncers
  - [x] [Batch/bootstrap](https://github.com/joodaloop/sssync/commit/068f1bcd36abd5f8bac0887c67458e94988811c5)
- [ ] Handle the `store-updated` Broadcast Channel coordinator

## Persistence (IDB)
- [ ] Handle the `schema-changed` Broadcast Channel coordinator
- [ ] Build an IndexedDB database management system
- [ ] Coordinate the startup sequence (check for database, create if needed)
- [ ] Design API for storing mutation queue
- [x] [Design API for persisting store data](https://github.com/joodaloop/sssync/commit/18c53c26654781be9035c87ffa6723c6049c5941)
- [x] [Provide namespaced KV store](https://github.com/joodaloop/sssync/commit/7b2c6376a0b315d3bc7618d0be0fa7985e3bf89e)

## Integrations
- [ ] Solid.js wrapper with Stores on the reactive layers
- [ ] React wrapper with stable identity
- [ ] Figure out how to play well with SSR:
  - [ ] Surface query interface in a way that allows usage with a Loader function
  - [x] Make IDB storage purely pluggable
  - [x] Guard `BroadcastChannel` messages to only run on client

## Performance
- [ ] Make sure store APIs are fast
- [ ] Add perf tests for store => query connection
- [ ] Ensure that rebasing is fast

## QoL
- [ ] Add thorough docstrings to all files to drive agents and test creation
- [ ] Come up with a minimal set of key/id formats for everything
- [ ] Decide on a single format for passing along row changes
- [x] [Design error types for library](https://github.com/joodaloop/sssync/commit/828689ae2f701543653da3e9f06bf7f013ab1f9a)
- [x] [Switch to using tagged union Result type for typed error handling](https://github.com/joodaloop/sssync/commit/1fadf96a23db72fde0ef75cebdbb0d2662b5b10c)
- [x] [Flatten all table row vaildation into one shape (across network + persistence)](https://github.com/joodaloop/sssync/commit/d5cdd8df0184687eda048468189122052754fcfa)

<br/>

## Future
- Play code golf on largest modules to get things down to <10kb total
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
- [x] ~~[Switch to using `better-result` for typed error handling](https://github.com/joodaloop/sssync/commit/a7d7db728759c1e1fe64387cbd8a213ea9c0ed63)~~
- [x] ~~Decide on an event schema format~~
- [ ] ~~Figure out a nice projector API that is easy to use across backend and frontend~~
- [ ] ~~Build type-safe projectors that connect **events** and **schema** in a SSSync client~~
