---
title: Why SSSync?
---

## Introducing the tradeoffs

The sync engine space has 3 fundamental tradeoffs:
- Server-side rendering
- Partial sync
- Resource efficiency
- System complexity/unfamiliarity
- Offline capability

SSSync aims to provide you with the good side of almost all these tradeoffs, be handling the client complexity and specifying a straightforward contract for your server to follow. 

### 1. Server-side rendering "just works"

For apps that just need to return pages of data, the humble HTTP request can rarely be beat.

Since SSSync is a simple Suspense-enabled data fetching library with a hydration API. Using it in a framework like Tanstack Start looks like this:

```ts
```

### 2. Partial sync
Some would argue that the best kind of partial sync is provided by only syncing the results of the queries your app actually runs. Unfortunately, nearly all the services that provide this functionality sacrifice on the other points (efficiency, offline, complexity), althogh we do recommend trying some of them (Zero, Electric, Instant) out for yourself. 

SSSync provides 4 different data loading strategies, that when combined, form a useful version of partial sync.

### 3. Resource efficiency

The core of the SSSync is based on plain ol' HTTP, you can tack on websockets or SSE if you want to avoid polling or manual sync pulls, and even those are just used to tell the syncer "it's time to rerun", not carry any data or set up database subscriptions.

Most competing systems involve setting up subscriptions, requiring servers that are always running.

### 4, System complexity/unfamiliarity

Having running servers means more server management (or paying someone to manage them) and novel forms of bugs. 

### Offline functionality

Zero and Convex have no persistent offline mutations. Electric asks you to connect your own write path. Almost all of them have no support for handling queued offline mutations if your server database has changed. Jazz and Livestore are the only ones that give you real offline mutations.

## Proving it's versatility

SSSync hands you 4 different ways to load data, meant to cover the full gamut of all application needs, while caching as much as possible, minimising the need for network requests. They are:

.loadSubset() caches an arbitrary subset of data, returned by your /subset endpoint
.query(string).related(string[]) caches a single item (and it's named relation/s), requested from your /batch endpoint
.loadRows() allows you to pass in rows you've fetched yourself in application code
The `bootstrapSubset: string[]` in SSSync initialisation let's you fetch core data at app startup, and also sets the intial sync cursor

As an example, let's consider two types of apps:

### A classic forum


### An issue tracker

The data for project 123 => `loadSubset("project:123")` can return the issues; related data follows through graph access


For app data fetching, I’d use these high-level categories:
Initial bootstrap / recovery
Establishes the starting local dataset when creating, resetting, or repairing the store.

Continuous synchronization
Receives authoritative changes after bootstrap through a stream, long polling, or periodic sync.

Fetch-on-access / entity hydration
Loads a specific missing entity or relationship when code attempts to use it.

Application query fetches
Loads app-controlled queries: lists, filters, sorting, search, pagination, autocomplete, dashboards, and aggregates.

Named durable scopes / offline downloads
Explicitly downloads and retains a stable dataset such as a project, workspace, map region, or knowledge base.

Ephemeral server computations
Fetches results that generally should not enter the entity store: previews, validation, recommendations, quotes, calculations, reports, and one-off RPC results.

Resource fetching
Downloads non-row data such as images, videos, documents, attachments, and large blobs, usually through a separate resource cache.

Everything else is mostly a policy layered on these:
Prefetching is fetch-on-access or an application query performed early.
Background refresh is repeating an application query.
Polling is a transport for synchronization or refresh.
Infinite scrolling is paginated application fetching.
SSR hydration is bootstrap or preloaded application fetching.
Cache revalidation is refresh policy.
A consistent query bundle is a stronger form of application query fetch.
