# How TinyBase does reactive joins & queries

Notes from reading the TinyBase source (`src/queries/index.ts`, `src/relationships/index.ts`).

## The big idea: queries are materialized into real Stores

A query isn't a lazy view recomputed on read. TinyBase runs a small **dataflow pipeline of
internal `Store`s** and materializes the result as an actual TinyBase table you can listen to
like any other:

```
source store ──► preStore ──► resultStore (per query)
   (SELECT/JOIN/WHERE)   (GROUP/HAVING)
```

- `store` — the source store
- `preStore` — holds SELECT/JOIN/WHERE output _only when_ there's a GROUP or HAVING stage
- `resultStore` — the final materialized result table, one per query
- `paramStore` — holds query params

If there's no group/having, SELECT/JOIN/WHERE writes straight into the result store and
`preStore` is skipped. Because the result _is_ a Store, you subscribe to it with ordinary store
listeners (table → row → single cell granularity).

---

## Joins are strictly many-to-one

A join's `on` resolves **one** remote row id (`Id | undefined`), never a list. The result row is
written using the root row's own id, so **the result table always has exactly one row per root
row.** A join can never turn 1 source row into N result rows — there is no fan-out. This is a
deliberate design choice; it's what keeps the update mechanism cheap.

`Join` type overloads reduce to a few params:

- **joinedTableId** — table (or query id, with `asQuery: true`) to join to
- **on** — a cell id on the _from_ table, or a function `(getCell, rowId) => Id | undefined`
- **fromIntermediateJoinedTableId** — chain a join off a _previously joined_ table, forming a
  join tree/chain

---

## How reactivity stays incremental: the "sticky note" model

Analogy: two tables.

```
orders                 users
o1: { userId: u1 }     u1: { name: "Alice" }
o2: { userId: u2 }     u2: { name: "Bob" }
```

Query: "for each order, show the user's name."

For every order, TinyBase remembers which user it currently resolves to, and installs a listener
on **that one specific user row** — not on the whole `users` table.

- Order `o1` → watching `u1` only
- Order `o2` → watching `u2` only

### What happens on a change

- **Alice's name changes (`u1`)** — only the listener watching `u1` wakes; it belongs to `o1`, so
  only `o1`'s result row recomputes. `o2` is never touched.
- **`o1.userId` changes `u1`→`u2`** — recompute o1's target (now `u2`), compare to remembered
  target (`u1`): different, so **stop watching `u1`, start watching `u2`**, update the note,
  recompute o1's row.
- **Unrelated change (new user `u3`, or `u2` edited)** — nobody watches `u3` → nothing; only `o2`
  watches `u2` → only `o2` updates.

### The state that makes it work (`queries/index.ts`)

Each join clause carries a `remoteIdPairs` map:

```
remoteIdPairs: rootRowId ──► [remoteRowId, sourceStore, listenerId]
```

i.e. per (root row, join) it remembers **which remote row we resolved to last time** and **the
listener id installed for it**.

### Codepath: `listenToTable(rootRowId, ...)`

1. Build a `getCell` bound to the changed row.
2. For each child join, recompute the target: `remoteRowId = on(getCell, rootRowId)`.
3. Compare against memory: `previousRemoteRowId = remoteIdPairs[rootRowId]?.[0]`.
4. **The incremental guard — `if (remoteRowId != previousRemoteRowId)`:**
   - equal → **do nothing** (existing per-row listener stays). This is why unrelated edits churn
     zero listeners.
   - changed → tear down old listener (`delSourceStoreListeners`), install a new one scoped to the
     new remote row (`addRowListener(joinedTableId, remoteRowId, ...)` — concrete row id, not
     `null`), store the new `[remoteRowId, store, listenerId]`.
5. `writeSelectRow(rootRowId)` re-evaluates WHERE + SELECT for just this root row and
   writes/deletes the single result row.

When the joined row itself changes, the per-row listener's callback re-enters `listenToTable` at
that node, recurses into deeper joins, and hits `writeSelectRow(rootRowId)` again.

Seeded from the root-table listener `addRowListener(tableId, null, rootRowChanged)`, which recurses
down the join tree.

### Invariant

Active listeners = the root-table listener **+**, for every (root row, join edge) currently
resolving to a remote row, one listener scoped to that specific remote row id. Listeners are
added/removed **only when a join key actually moves**. A change touches O(join depth) listeners and
recomputes O(1) result rows — no table scans.

Escape hatch: a **functional `on`** (`(getCell) => ...`) can't be introspected, so the per-row
listener re-runs the whole `on` on any change to that joined row — still scoped to that row, not the
table.

### Transactions & params

- `synchronizeTransactions` wires start/finish-transaction listeners between pipeline stages, so one
  source transaction flows through as a single transaction; result listeners fire **once per source
  transaction**, batched.
- **Params are NOT incremental**: changing a param re-runs the whole `build` (tears down and rebuilds
  all listeners), by design.

---

## One-to-many

A join can't express it (no fan-out). Two options:

### Answer 1: flip the query and aggregate (GROUP BY)

Query the **many side** and collapse. "Each user with order count + total":

```js
queries.setQueryDefinition('userStats', 'orders', ({ select, join, group }) => {
  join('users', 'userId') // each order → its user (many-to-one)
  select('users', 'name').as('userName')
  select('amount')
  group('amount', 'sum').as('total') // collapse all orders per user
  group('amount', 'count').as('orders')
})
```

Result: one row per user with `total` and `orders`. GROUP/HAVING stays incremental via
add/remove/replace aggregators over a value-keyed tree — one order changing only nudges its group's
aggregate. Catch: you get **aggregates only**, not the raw list of child rows (a query result is a
flat table, no nested arrays).

### Answer 2: the Relationships module (when you want the actual list)

`getRemoteRowId('orderUser', 'o1') → 'u1'` (the "one" side) and
`getLocalRowIds('orderUser', 'u1') → ['o1','o5','o9']` (the "many" side, the actual list).

| You want…                            | Use                                  | Result shape                      |
| ------------------------------------ | ------------------------------------ | --------------------------------- |
| Each order + its user's name         | **Join** (many-to-one)               | one row per order                 |
| Each user + count/sum of orders      | **Query with `group`**               | one row per user, aggregates only |
| Each user → actual list of order ids | **Relationships** (`getLocalRowIds`) | a list you fetch per user         |

---

## Relationships module internals (`relationships/index.ts`)

### Two maps, pointing both ways

```js
type Relationship = [
  IdMap<Id>,        // localRows:  localRowId  → remoteRowId          (the "one" side)
  IdMap<IdSet>,     // remoteRows: remoteRowId → Set<localRowId>      (the "many" side)
  ...               // two more slots: cache for getLinkedRowIds (self-joins)
]
```

Example:

```
localRows:   { o1→u1, o2→u2, o5→u1, o9→u1 }
remoteRows:  { u1→{o1,o5,o9},  u2→{o2} }
```

- `getRemoteRowId` reads map #0 — O(1)
- `getLocalRowIds` reads map #1's set — O(1) + copy

Both are cheap because both maps are kept in sync on every change.

### Staying in sync: the change handler

The definable plumbing watches the local cell (`userId`) and hands the callback a map of what moved:

```
changedRemoteRowIds:  localRowId → [oldRemoteRowId, newRemoteRowId]
```

When `o1.userId` goes `u1`→`u2`, this is `{ o1: [u1, u2] }`. The handler:

1. **Pull local row out of OLD remote's set**:
   ```js
   const oldRemoteRow = mapGet(remoteRows, oldRemoteRowId) // u1 → {o1,o5,o9}
   collDel(oldRemoteRow, localRowId) // → {o5,o9}
   if (collIsEmpty(oldRemoteRow)) mapSet(remoteRows, oldRemoteRowId) // drop empty
   ```
2. **Push into NEW remote's set**:
   ```js
   if (!collHas(remoteRows, newRemoteRowId)) mapSet(remoteRows, newRemoteRowId, setNew())
   setAdd(mapGet(remoteRows, newRemoteRowId), localRowId) // u2 → {o2,o1}
   ```
3. **Update forward map**: `mapSet(localRows, localRowId, newRemoteRowId)` // o1→u2

Only the two sets involved (old user, new user) are touched — nothing else is read or rewritten.

### Firing listeners

After committing the change:

- `changedLocalRows` → fire `remoteRowIdListeners` for `o1`
- `changedRemoteRows` → fire `localRowIdsListeners` for **both `u1` and `u2`** (one list shrank, one
  grew)

Watchers of `u3` hear nothing.

### `getLinkedRowIds` (self-joins)

The extra tuple slots cache linked chains when local and remote tables are the **same** (linked
list / tree via `next` or `parent`). `getLinkedRowIdsCache` walks the chain following `remoteRows`
until it loops/ends, and memoizes; a change invalidates any cached chain containing the moved row.
For different-table relationships this branch is skipped (a "linked" set is just the row itself).

### Cost summary

| Call                   | Reads                                                | Cost                  |
| ---------------------- | ---------------------------------------------------- | --------------------- |
| `getRemoteRowId(o1)`   | forward map                                          | O(1)                  |
| `getLocalRowIds(u1)`   | reverse map's set                                    | O(1) + copy           |
| order's userId changes | del from old set, add to new set, update forward map | O(1), 2 users touched |

The reverse index is never rebuilt — it's incrementally patched on each change.

---

## Granularity summary

| Layer                      | Granularity                                                                   |
| -------------------------- | ----------------------------------------------------------------------------- |
| Param change               | Full query rebuild                                                            |
| Source/joined row change   | Per-root-row incremental recompute                                            |
| Join subscriptions         | Per-exact-remote-row listeners, re-pointed only when join keys move           |
| Aggregates                 | Incremental add/remove/replace per changed cell, grouped via value-keyed tree |
| Notifications              | Coalesced to one per source transaction                                       |
| Result reads/listeners     | Table → row → single cell                                                     |
| Relationship reverse index | Incrementally patched (two sets touched per change)                           |
