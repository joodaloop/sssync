# SSSync is a library for offline-capable state mangement across the network

It is opinionated when being so helps enforce robustness, and very flexible otherwise.

Robustness it garuntees:
- Rebasing the offline event queue each time a loader or puller runs
- Clearing confirmed events from the offline queue once the backend has confirmed them, rebase the rest
- Making sure that puller data is queued and rebased over in-flight loaders

The core SSSync class looks like:
```ts
const sss = new SSSync({
  id: string, 
  schema: ZeroTableSchemas,
  events: Events,
  projectors: Projectors,
  store, // solid-store, solid-ivm, react, react-legend, etc.
  loaders: Loaders,
  puller?: Puller,
})

const {data, err} = sss.commit.eventName(eventArgs)
const meta = sss.metadata()
sss.loaders.loaderName(args)
```

It coordinates cross-tab leadership for:
- Commits: Original tab applies the commit in-memory immediately, then forwards to the leader to persist it and announce changed store items to other tabs
- Loaders: All calls instruct leader tab to run them, and announce changed store items to other tabs
- Pullers: Get access to sssync.isLeader() in order to run from a single tab


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

A loader is a way to load data that matches tableSchemas, either cached forever or refreshed when called again:
```ts
const loaders = {
  postLoader: (args) => ({
    fetcher: () => fetch('/bootstrap/posts/' + args.year),
    once: true,
  })
}
```

Pullers are plugins for syncing changes into the store over time:
```ts
class S2Puller = {
  constructor(sss: SSSync){
    
  }
  
  connectToStream(streamId: string){
    // open SSE connection using lastSyncId for this streamId
  }
}
