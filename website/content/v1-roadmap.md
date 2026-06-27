---
title: 1.0 Roadmap
description: Todo list & progress tracking
---

## Schema
- [x] [Copy over code from Zero Schema so that we can drop that dependency and gain flexibility if needed in the future](https://github.com/joodaloop/sssync-beta/commit/dcffe4bb57ab88fe9d021634e394943c82f6b098)

## ~~Events~~ Mutators

- [x] [Decide on an event schema format](https://github.com/joodaloop/sssync-beta/blob/80360dfddba47bd1c9bb33cabeb7b15798ae4072/website/content/docs/events.md)
- [x] [Build type-safe event definitions, with a Standard Schema `data` field](https://github.com/joodaloop/sssync-beta/commit/15d512c14b0d23aa6c9fd88b18e7811a5b95fd55)
- [x] [Switch over to using mutators instead of the event/projector separation](https://github.com/joodaloop/sssync/commit/8230a567fbeb45c02e03815f82cc5f98ab6c4968)
- [ ] Build log of mutations (optional persistence)

## Query DSL
- [x] [Finalise design for query builder](https://github.com/joodaloop/sssync/commit/3e255be4fd00f77772a3ee91b83d3dd02c0c10e7)
- [ ] Build system for relationship indexes

## Network requests
- [ ] Build bootstrap lifecycle manager
- [ ] Design batch loader

## Store
- [ ] Design APIs to write to the store
- [ ] Build an IndexedDB database management system

## Cross-tab coordination
- [ ] Decide how data will be queued and flushed
- [ ] Add a `schema-changed` Broadcast Channel message

## Putting it all together
- [ ] Figure out how to play well with SSR
- [ ] Connect query layer with batch loader
- [ ] Connect batch loader with storage
- [ ] Coordinate the startup sequence (check database, set up store, bootstrap)
- [ ] Connect mutations rebasing to store

## Integrations

### Solid.js integration
- [x] [Build a wrapper over the core SSSync class](https://github.com/joodaloop/sssync/commit/2db554f676548bc3fd94bcc6b910b79ee47b4f7f)


## Dead ends

## ~~Projectors~~
- [ ] ~~Figure out a nice projector API that is easy to use across backend and frontend~~
- [ ] ~~Build type-safe projectors that connect **events** and **schema** in a SSSync client~~
