---
title: An Overview of the System
description: High-level summary of the API surface (schemas, events, projectors, query DSL, and syncers)
---

It is opinionated when being so helps enforce robustness, and very flexible otherwise.
- Rebasing the offline event queue each time a loader or puller runs
- Clearing confirmed events from the offline queue once the backend has confirmed them, rebase the rest
- Making sure that puller data is queued and rebased over in-flight loaders

The core SSSync class looks like:
```ts
const sss = new SSSync({
  id: string, 
  schema: Tables,
  events: Events,
  projectors: Projectors,
  store, // solid-store, solid-ivm, react, react-legend, etc.
  puller?: Puller,
})

const {data, err} = sss.commit('eventName', eventArgs)
const meta = sss.metadata()
sss.loaders.loaderName(args)
```

Schemas are declared using Zero's syntax:
```ts
export type TableSchema = {
  readonly name: string;
  readonly columns: Record<string, SchemaValue>;
  readonly primaryKey: PrimaryKey;
};
```

Events looks like:
```ts
const events = {
  'v1.postAdded': {
    id: v.string(),
    content: v.string()
  },
  'v2.postAdded': {
    id: v.string(),
    content: v.string(), 
    title: v.string()
  }
}
```

Projectors need to be defined like: 
```ts
const projectors = {
  'v1.postAdded': ({id, content}) => [{
    type: 'add',
    table: 'posts',
    data: {id, content, title: 'Untitled'}
  }],
  'v2.postAdded': ({id, content, title}) => [{
    type: 'add',
    table: 'posts',
    data: {id, content, title}
  }]
}
```

A store is an interface that exposes either the raw data, or a ZQL query interface which outputs framework-specific stores.
```ts
const posts = useData(sss, 'posts')
// OR
const query = useLiveQuery(sss)
const posts = query.posts
```

A loader is a way to load data that matches tableSchemas, cached forever:
```ts
const loaders = {
  postLoader: (args) => ({
    fetcher: () => fetch('/bootstrap/posts/' + args.year),
    priority: 1 // 0 to Infinity
  })
}
```

Pullers are plugins for syncing changes into the store over time:
```ts
class S2Puller = {
  constructor(applyRowChanges: () => boolean, KVStore){
    
  }
  
  connectToStream(streamId: string){
    // open SSE connection using lastSyncId for this streamId
  }
}
```

Pullers are pluggable in order to support multiple ways of syncing data, while continuing to use the other nice parts of SSSync. We would like to provide first class pullers for:
- Different network bridges
  - Client pull (request/response)
  - Server push over a held-open connection
  - Broker-mediated pub/sub
Ordering strategies:
  - Total order
  - Partial orders
  - Causal order
Change formats:
  - Diffs
  - Full objects
  - Operations/event)
