# Zero Framework - Package Architecture Overview

A brief architectural guide to @zero, @zql, @zero-schema, and @zero-client packages for future agent context.

---

## 1. Package Purposes

### @rocicorp/zero
- **Main entry point** for the Zero framework
- Server-side backend + client-side SDK
- Orchestrates all components
- CLI tools, build utilities, adapters (Drizzle, Prisma, PostgreSQL)
- Bindings for SQLite, Op-SQLite, Expo-SQLite

**Key Exports:**
- `zero.ts` - Main SDK entry
- `server.ts` - Server-side APIs
- `react.ts`, `solid.ts` - Framework integrations
- CLI: `cli.ts`, `build-schema.ts`, `ast-to-zql.ts`, `analyze-query.ts`

### @zql
- **Query language engine** and IVM (Incremental View Maintenance) core
- Compiles queries → streaming operator pipelines
- Handles mutations via push protocol
- Zero client-side query execution

**Key Dirs:**
- `query/` - Query building, validation, registry (most complex)
- `ivm/` - Operator graph implementation (filters, joins, takes, skips, fan-in/out, exists)
- `builder/` - Query → pipeline compilation
- `planner/` - Query optimization
- `mutate/` - Mutation execution

### @zero-schema
- **Type-safe schema definition** (tables, columns, relationships, permissions)
- Schema builder API
- Permission rules compilation
- Name mapping (client ↔ server)

**Key Files:**
- `builder/` - Schema/table/relationship builders
- `permissions.ts` - Permission rules
- `table-schema.ts` - Table type definitions

### @zero-client
- **Client-side runtime** for web/mobile
- Replicache integration (local state sync)
- Query materialization (turning IVM streams into data)
- Connection management, mutations, error handling
- Inspector/debugging tools

**Key Dirs:**
- `client/` - All client logic (most complex)
  - `zero.ts` - Main Zero client class (2400+ lines)
  - `query-manager.ts` - Query lifecycle, subscription tracking
  - `ivm-branch.ts` - IVM state branching for mutation rebasing
  - `connection-manager.ts` - WebSocket/network
  - `metrics.ts`, `mutation-tracker.ts` - Observability
  - `inspector/` - Debug tools

---

## 2. Most Complicated Parts

### Query Execution Pipeline (zql)
**Complexity:** ⭐⭐⭐⭐⭐
- **Problem:** Turn declarative queries → incremental data updates
- **Solution:** Build operator graph (stream-based operators with push/fetch semantics)
- **Hardest:** Joins, EXISTS conditions, ordering preservation across operators
- **Files:**
  - `zql/src/query/query-impl.ts` - Core query compilation (600+ lines)
  - `zql/src/builder/builder.ts` - Pipeline construction (800+ lines)
  - `zql/src/ivm/join.ts`, `flipped-join.ts` - Join implementation
  - `zql/src/planner/` - Query planning/optimization

### IVM Materialization (zql/ivm)
**Complexity:** ⭐⭐⭐⭐⭐
- **Problem:** Stream data changes through operator graph, maintaining correctness
- **Solution:** Fetch-then-push model with incremental updates
- **Hardest:** Ordering, deduplication, constraint handling, source diffs
- **Files:**
  - `zql/src/ivm/view-apply-change.ts` - Applying deltas to views
  - `zql/src/ivm/operator.ts` - Base Input/Output interfaces
  - `zql/src/ivm/{join,exists,filter,take,skip}.ts` - Operator implementations
  - `zql/src/ivm/stream.ts` - Streaming utilities

### Client State Synchronization (zero-client)
**Complexity:** ⭐⭐⭐⭐
- **Problem:** Keep local Replicache state in sync with server, handle offline mutations
- **Solution:** IVM branch forking + mutation rebasing
- **Hardest:** Mutation replay on stale commits, poke handling, connection transitions
- **Files:**
  - `zero-client/src/client/zero.ts` - Main state machine (2400+ lines)
  - `zero-client/src/client/ivm-branch.ts` - Branching for mutation reads
  - `zero-client/src/client/zero-poke-handler.ts` - Server push handling
  - `zero-client/src/client/connection-manager.ts` - Network lifecycle

### Query Expression & Condition Handling (zql/query)
**Complexity:** ⭐⭐⭐⭐
- **Problem:** Type-safe, composable query building with complex condition logic
- **Solution:** Expression builder with AST compilation, simplification, flattening
- **Hardest:** Condition simplification, correlated subqueries, TTL management
- **Files:**
  - `zql/src/query/expression.ts` - ExpressionBuilder, condition combinators
  - `zql/src/query/query-impl.ts` - Core Query implementation
  - `zql/src/query/query-delegate-base.ts` - Query execution protocol

---

## 3. Relationships Between Packages

```
@rocicorp/zero (main)
  ├─ depends on @zql (query engine)
  ├─ depends on @zero-schema (schema types)
  ├─ depends on @zero-client (client runtime)
  └─ exports server/ for backend usage

@zero-client (client runtime)
  ├─ imports from @zql (IVM operators, Query)
  ├─ imports from @zero-schema (schema metadata)
  ├─ wraps Replicache (local sync)
  └─ materializes queries via IVM

@zql (query engine)
  ├─ imports from @zero-schema (schema types)
  ├─ compiles queries → operator graphs
  ├─ provides IVM implementation
  └─ no dependency on @zero-client

@zero-schema (schema)
  ├─ independent (just types & builders)
  └─ imported by @zql, @zero-client
```

**Data Flow Example:**
1. User defines schema with `createSchema()` (@zero-schema)
2. User writes query with `createBuilder().from(...).where(...)` (@zql)
3. Client calls `z.query(myQuery)` (@zero-client)
4. QueryManager tracks subscription → sends to server
5. Server materializes via IVM pipeline (@zql)
6. Server pushes updates → client receives via poke handler
7. IVMSourceBranch applies diffs to local IVM for mutation reads

---

## 4. Categorized File Paths

### IVM (Incremental View Maintenance)
**Core Streaming Engine:**
- `zql/src/ivm/operator.ts` - Input/Output/Operator interfaces
- `zql/src/ivm/stream.ts` - Stream protocol (generator-based)
- `zql/src/ivm/view.ts` - View type definitions (Entry, EntryList)

**Operators (Data Transformations):**
- `zql/src/ivm/source.ts` - Data source base
- `zql/src/ivm/memory-source.ts` - In-memory storage source
- `zql/src/ivm/filter.ts` - Row filtering
- `zql/src/ivm/join.ts`, `zql/src/ivm/flipped-join.ts` - Joins (2+ sources)
- `zql/src/ivm/take.ts` - LIMIT + OFFSET
- `zql/src/ivm/skip.ts` - Skip rows
- `zql/src/ivm/exists.ts` - EXISTS conditions
- `zql/src/ivm/fan-in.ts`, `zql/src/ivm/fan-out.ts` - Multiplexing
- `zql/src/ivm/union-fan-in.ts`, `zql/src/ivm/union-fan-out.ts` - Union handling
- `zql/src/ivm/catch.ts` - Error handling in pipeline

**Change Processing:**
- `zql/src/ivm/change.ts` - Change type (add/remove/edit)
- `zql/src/ivm/view-apply-change.ts` - Applying incremental deltas
- `zql/src/ivm/constraint.ts` - Uniqueness/ordering constraints
- `zql/src/ivm/filter-operators.ts` - Predicate compilation

**Storage & State:**
- `zql/src/ivm/memory-storage.ts` - In-memory K-V for operator state
- `zql/src/ivm/data.ts` - Node/Data types

**Client-Side IVM Branching:**
- `zero-client/src/client/ivm-branch.ts` - Mutation rebasing via IVM forks

### Query Language
**Query Building:**
- `zql/src/query/query.ts` - Query interface & types (228+ lines)
- `zql/src/query/query-impl.ts` - QueryImpl class (575+ lines)
- `zql/src/query/create-builder.ts` - Builder factory
- `zql/src/query/schema-query.ts` - Type-safe query builder DSL

**Expression & Conditions:**
- `zql/src/query/expression.ts` - ExpressionBuilder, condition operators
- `zql/src/builder/builder.ts` - Pipeline compilation from AST (800+ lines)
- `zql/src/builder/filter.ts` - Condition to predicate conversion
- `zql/src/query/validate-input.ts` - Input parameter validation

**Query Registry & Named Queries:**
- `zql/src/query/query-registry.ts` - Query registration, retrieval
- `zql/src/query/named.ts` - `syncedQuery()` and `defineQuery()`
- `zql/src/query/metrics-delegate.ts` - Query metrics tracking

**TTL Management:**
- `zql/src/query/ttl.ts` - Time-to-live parsing, comparison, clamping

**Query Execution:**
- `zql/src/query/query-delegate-base.ts` - Base protocol for query execution
- `zql/src/query/runnable-query-impl.ts` - Server-side query runner
- `zql/src/query/query-internals.ts` - Internals accessors

### Query Optimization & Planning
- `zql/src/planner/planner-builder.ts` - Plan generation
- `zql/src/planner/planner-connection.ts` - Join cost modeling
- `zql/src/planner/planner-debug.ts` - Plan visualization

### Mutation/CRUD
- `zql/src/mutate/crud.ts` - Insert/upsert/update/delete operations
- `zql/src/mutate/mutator.ts` - Mutator definition
- `zql/src/mutate/mutator-registry.ts` - Mutator registration
- `zql/src/mutate/custom.ts` - Custom transaction types

### Schema & Types
**Schema Building:**
- `zero-schema/src/builder/schema-builder.ts` - `createSchema()` factory
- `zero-schema/src/builder/table-builder.ts` - `table()`, column types
- `zero-schema/src/builder/relationship-builder.ts` - `relationships()`

**Schema Metadata:**
- `zero-schema/src/table-schema.ts` - TableSchema type definition
- `zero-schema/src/schema-config.ts` - Schema configuration
- `zero-schema/src/name-mapper.ts` - Client ↔ server name mapping

**Permissions:**
- `zero-schema/src/permissions.ts` - Permission rule DSL
- `zero-schema/src/compiled-permissions.ts` - Compiled permission format

### Client Runtime
**Main Client:**
- `zero-client/src/client/zero.ts` - Zero client class (2447 lines!) + OnlineManager

**Query Management:**
- `zero-client/src/client/query-manager.ts` - Query subscription tracking, deduplication
- `zero-client/src/client/mutation-tracker.ts` - Pending mutation tracking
- `zero-client/src/client/ivm-branch.ts` - IVM state branching

**Connection & Network:**
- `zero-client/src/client/connection.ts` - Connection interface & impl
- `zero-client/src/client/connection-manager.ts` - Connection lifecycle state machine
- `zero-client/src/client/connect-checks.ts` - Connectivity verification

**Data Synchronization:**
- `zero-client/src/client/zero-poke-handler.ts` - Server push (poke) message handling
- `zero-client/src/client/zero-rep.ts` - Replicache wrapper/options

**CRUD & Mutations:**
- `zero-client/src/client/crud.ts` - CRUD API builders (insert, upsert, update)
- `zero-client/src/client/crud-impl.ts` - CRUD implementation
- `zero-client/src/client/custom.ts` - Custom mutator proxy
- `zero-client/src/client/mutator-proxy.ts` - Mutator invocation

**Observability & Debugging:**
- `zero-client/src/client/metrics.ts` - MetricManager, Gauge, State (metrics collection)
- `zero-client/src/client/error.ts` - Error types (ClientError, ServerError, etc.)
- `zero-client/src/client/reload-error-handler.ts` - Reload logic & backoff
- `zero-client/src/client/inspector/inspector.ts` - Debug tools RPC
- `zero-client/src/client/inspector/lazy-inspector.ts` - Lazy loading inspector

**Keys & Storage:**
- `zero-client/src/client/keys.ts` - Replicache key generation
- `zero-client/src/client/test/create-db.ts` - Test utilities

**Utilities:**
- `zero-client/src/client/http-string.ts` - URL type safety
- `zero-client/src/client/log-options.ts` - Logging configuration
- `zero-client/src/client/enable-analytics.ts` - Analytics feature gate
- `zero-client/src/client/version.ts` - Version tracking

### Caching & Storage Behavior
**Query Caching:**
- `zero-client/src/client/query-manager.ts` - Deduplicates identical queries
- `zero-client/src/client/ivm-branch.ts` - Caches IVM source branches by hash
- `zql/src/query/ttl.ts` - Controls cache expiration

**Local State (Replicache):**
- `zero-client/src/client/zero-poke-handler.ts` - Applies server mutations to local state
- `zero-client/src/client/zero-rep.ts` - Replicache instance management
- Storage keys: `ENTITIES_KEY_PREFIX`, `GOT_QUERIES_KEY_PREFIX`, `toDesiredQueriesKey()` etc.

**IVM State Storage:**
- `zql/src/ivm/memory-storage.ts` - Operator state persistence
- Each operator can store state for efficient incremental updates

---

## 5. Key Data Flow Examples

### Query Execution (Client → Server → Client)
```
User code:
  const results = await z.query(myQuery).materialize()
    ↓
zero-client/zero.ts:
  - QueryManager adds to subscriptions
  - Sends ChangeDesiredQueriesMessage
    ↓
Server:
  - zql/builder.ts builds operator pipeline
  - zql/ivm/ operators stream results
  - Sends initial snapshot + poke messages
    ↓
zero-client:
  - PokeHandler applies mutations
  - IVMSourceBranch handles offline mutations
  - Returns materialized data
```

### Mutation with Offline Support
```
User code:
  await z.mutate.myTable.insert({...})
    ↓
zero-client/crud.ts:
  - Adds to MutationTracker
  - Calls Replicache mutator
    ↓
Replicache:
  - Stores in IndexedDB
  - Marks as pending
    ↓
When online:
  - Server receives mutation
  - IVMSourceBranch forks IVM state
  - Mutation reads execute against fork
  - Mutation committed + diffs pushed to client
```

### Condition Compilation
```
User query:
  from('users').where(and(eq(f.age, 30), gt(f.score, 100)))
    ↓
zql/query/expression.ts:
  - Builds AST Conjunction with SimpleConditions
  - Simplifies & flattens
    ↓
zql/builder/builder.ts:
  - Compiles to predicate function via createPredicate()
  - Builds Filter operator
    ↓
zql/ivm/filter.ts:
  - Applies predicate to rows in stream
```

---

## 6. Critical Implementation Notes

### Ordering & Deduplication
- Queries must maintain row order through entire pipeline
- `complete-ordering.ts` ensures PK included in ORDER BY
- `view-apply-change.ts` deduplicates via deep equality
- Joins use sorting to match rows across inputs

### Push-Based Incremental Updates
- Operators receive fetched data, then incremental pushes
- Can only add rows not existing; can only remove existing
- Maintains internal sorted data structures for correctness
- Used for reactive updates without full re-fetch

### Mutation Rebasing
- `IVMSourceBranch` forks sources to a specific commit
- Mutation reads execute against fork (not main IVM)
- Diffs applied to fork to advance it to mutation commit
- Allows correct reads of not-yet-synced data

### TTL & Freshness
- Queries can specify freshness requirements (TTL)
- `query-manager.ts` tracks and enforces freshness
- Client requests push refresh when TTL expired
- Server throttles refresh requests

### Query Deduplication
- Same query subscribed by multiple components → one IVM pipeline
- `query-manager.ts` counts subscribers, deduplicates hashes
- Updates materialized only once per push
- Critical for performance with many components

---

## 7. Testing Patterns

- **Unit:** `*.test.ts` files in each directory
- **Props-based:** `fast-check` for query generation in zql tests
- **Integration:** Stress tests for client sync in zero-client
- **Test Utilities:** `zql/src/query/test/`, `zero-client/src/client/test-utils.ts`

---

## 8. Key Algorithms

| Component | Algorithm | File |
|-----------|-----------|------|
| Join | Hash-based with sorted iteration | `zql/src/ivm/join.ts` |
| Filter | Stream predicate application | `zql/src/ivm/filter.ts` |
| Take/Skip | Window-based with state tracking | `zql/src/ivm/take.ts`, `skip.ts` |
| Exists | Fan-out/fan-in subquery correlation | `zql/src/ivm/exists.ts` |
| View Apply | Sorted list insertion/removal with dedup | `zql/src/ivm/view-apply-change.ts` |
| Query Plan | Cost-based join reordering | `zql/src/planner/` |

---

## Next Steps for Agents

When implementing features:
1. **Schema changes** → edit `zero-schema/src/`
2. **Query features** → edit `zql/src/query/` or `zql/src/builder/`
3. **Operators** → edit `zql/src/ivm/`
4. **Client behavior** → edit `zero-client/src/client/`
5. **Tests** → add `*.test.ts` in same directory
6. Always verify: does this affect ordering? Deduplication? TTL? Offline mutations?
