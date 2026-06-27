---
title: Design Notes (June 2026)
description: Working notes on pluggable syncers, storage, materializers, evictions, migrations, the fetch protocol, and the query DSL.
---

How i'm thinking about things rn

## Event lifecycle

Transactions progress through the following states during their lifecycle:

pending: Initial state when a transaction is created and optimistic mutations can be applied

persisting: Transaction is being persisted to the backend

completed: Transaction has been successfully persisted and any backend changes have been synced back

failed: An error was thrown while persisting or syncing back the transaction

## Event compression

Existing → New	Result	Description
insert + update	insert	Keeps insert type, merges changes, empty original
insert + delete	removed	Mutations cancel each other out
update + delete	delete	Delete dominates
update + update	update	Union changes, keep first original

## Undo-redo?

Should be left upto the developer because it's too domain-specific.

## Client-only events 

Especially for input elements to use.

## How to handle foreign key breaking/cascade?

1. Partial local data means the client cannot enumerate all children.
2. Delete may fail on the server, so local cascade might need rollback.
3. Server business logic may do delete/null/archive/history, not a simple cascade.
4. Other clients need ordered sync actions for the same child deletions.
5. Pending mutations may reference the child rows.
6. Reconnect/missed-packet recovery needs sync IDs for every authoritative change.
7. Old clients may have different relationship metadata.
8. Permissions may hide some children, so the client is not allowed to know them.

## Pluggable syncers

## Storage
- Persistent
  - IndexedDB, with user-defined indexes
- In-memory (API still async due to network requests)

## Materializers can return:
- CREATE
- UPDATE
- DELETE

Should they have access to the `db` object inside them? How can that be possible without allowing arbitrary code?

> The lookup function takes the attribute as its first argument and the unique attribute value as its second argument.
> 
> When it is used in a transaction, the updates will be applied to the entity that has the unique value. If no entity has the value, then a new entity with a random id will be created with the value.

I think lookup is only needed here because "unlink" is a special action for them? In my database, we would auto-casecade, right?

What about a Counter type update?

## Evictions
Models that don't have an associated `bootstraped: true` can be evicted through `db.evict(id)` that goes through all the relation sets it satisfies and invalidates them. Can be used to evict search results, old chat items, sort/limit queries, etc. 

Q: ::Can't evict anything that is needed for rebase, what to do??:: 
A: Queue the eviction and wait until there are no pending mutations to run it.

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




## Notes from jazz.tools

IndexScan → [Union] → Materialize → [PolicyFilter]
  → [ArraySubquery] → [Filter] → [Sort] → [LimitOffset]
  → [Project] → Output

Uses a single tab as the storage tab using web locks, communicates through BroadcastChannel.
