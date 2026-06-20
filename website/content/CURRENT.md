How i'm thinking about things rn

## Sync groups (with shared data)

## Pluggable syncers

## Storage
- Persistent
  - IndexedDB, with user-defined indexes
- In-memory (API still async due to network requests)

## Materializers can return
- CREATE
- UPDATE
- DELETE

Should they have access to the `db` object inside them? How can that be possible without allowing arbitrary code?

## Evictions
Models that don't have an associated `bootstraped: true` can be evicted through `db.evict(id)` that goes through all the relation sets it satisfies and invalidates them. Can be used to evict search results, old chat items, sort/limit queries, etc. 

::Can't evict anything that is needed for rebase, what to do??::

## Migrations
Per-table is possible if evict is made feasible, otherwise blow away the full database.

If app code schema hash doesn't match the local database one, `GET /schema` request that returns the current hash/version number to check if it's behind or ahead.

## Fetch protocol
The server must be set up to handle the following requests at it's `batchURL` (being able to configure batchURL allows for versioning/reshaping data sent back to client). Imagine a mobile client having batchURL `/mobile` that ensures data is transformed to a format it's outdated client can still understand while the web can always use the current one at `/batch` or whatever.

### Batches
The server receives `{model: "issue", id: 1, relation?: "comments"}`

### Bootstrap
`/bootstrap?models=issue,project`

These 3 things can be composed to achieve:
- **Range scans/search:** Make a regular fetch() request that returns ids of elements, then just hydrate elements with those ids by calling .single(id) for each element.
- **Core or delayed bootstrap:** Choose when to call the bootstrap function for a model, and track it's completion to know when to block rendering of parts of the app.
- **Fetch-on-access:** Through visiting .single(id) or .related(model), which triggers the correct batch call when needed.

## Query DSL
```ts
db.issues.single(id).related("comments").elements // .comments is a relation, can only be called on single(), and triggers a fetch-on-access if missing
db.issues.elements // just a simple local list
```

For many-to-many relations:

> `issues.single(id).related("labels")` will send `{model: "issue", id: 1, relation?: "labels"}` to the server, which must return both the `issueToLabel` linking table and the `labels` themselves. The client provides access to the junction rows through `.related("labels").links`, since it will always exist and shouldn't be a separate table. 




## Jazz

IndexScan → [Union] → Materialize → [PolicyFilter]
  → [ArraySubquery] → [Filter] → [Sort] → [LimitOffset]
  → [Project] → Output

Uses a single tab as the storage tab using web locks, communicates through BroadcastChannel.
