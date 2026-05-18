

The core SSSync class looks like:
```ts
const sss = new SSSync({
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
It coordinates cross-tab everything.


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
