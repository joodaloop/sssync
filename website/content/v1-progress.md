---
title: 1.0 Roadmap
description: Todo list & progress tracking
---

## Schema
- [x] [Copy over code from Zero Schema so that we can drop that dependency and gain flexibility if needed in the future](https://github.com/joodaloop/sssync-beta/commit/dcffe4bb57ab88fe9d021634e394943c82f6b098)

## ~~Events~~ Mutators

- [x] [Decide on an event schema format](https://github.com/joodaloop/sssync-beta/blob/80360dfddba47bd1c9bb33cabeb7b15798ae4072/website/content/docs/events.md)
- [x] [Build type-safe event definitions, with a Standard Schema `data` field](https://github.com/joodaloop/sssync-beta/commit/15d512c14b0d23aa6c9fd88b18e7811a5b95fd55)
- [x] [Switch over to using client mutators instead of the event/projector separation](https://github.com/joodaloop/sssync/commit/8230a567fbeb45c02e03815f82cc5f98ab6c4968)

## ~~Projectors~~
- [ ] ~~Figure out a nice projector API that is easy to use across backend and frontend~~
- [ ] ~~Build type-safe projectors that connect **events** and **schema** in a SSSync client~~

## Query DSL
- [ ] Design types w.r.t. `hydrate` vs. simple access
- [ ] Decide how relationship indexes will be represented in-memory

## Network requests
- [ ] Build bootstrap lifecycle manager
- [ ] Design batch loader
- [ ] Figure out how this will work during SSR

## Storage
- [ ] Build an IndexedDB database management system

## Cross-tab coordination
- [ ] Decide how data will be queued and flushed
- [ ] Add a `schema-changed` Broadcast Channel message
