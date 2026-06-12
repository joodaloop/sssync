
## Reducing memory usage in the aggregate will include
- Re-running queries against disk as much as possible to have the minimum in-use set.
- BUT:
    - If mutations can read local state before rebasing, then having everything in memory makes replaying mutations cheap.
    - You can sometimes miss next-frame rendering
    - 

### Possible solution: use Zero's server tracking method
They track when data is a prefix, complete, etc. So my Zero query client can just pretend like going to disk is like going to the server.
**This will need testing**

## Can we do temporary data fetches mixed in with permanent ones?
Why do we need it? 
- Avoid bloating disk space (slower rescans)
- Re-requesting data outside of our sync subset, like visiting open pages

Problems:
- Local mutations that rely on temp data will fail
- Can bring in some data, but not all related data, causing foreign key queries to fail. [Split-brain problem](https://docs.powersync.com/architecture/consistency) from Powersync.

Possible solutions: 
- [Powersync](https://docs.powersync.com/architecture/consistency): Don't bring in any new data unless local mutation queue has cleared and has arrived through the change log round trip
- Just drop any failed mutations, rare enough, and will self-repair eventually


## When do you need non-idempotency?

### You don't need it for
- Counters: Just make each increment it's own row
- Positions: Use fractional indexes, or linking to previous element
- Toggles, relative position changes, : People want to set these to a certain value, not some weird "relative change".

### You do need it for
- Derived values: Often, for performance reasons, you don't want to re-derive values from multiple rows
- Bounded/limited resources: You shouldn't be using these in a local-first app though...
- Compare and Swap and conditional apply:
- Text editing: Need to transform operations relative to current state in order to rebase


## When do we need to rerun?

- **`ORDER BY ... LIMIT` / top-N**
“latest 50 posts,” “top issues,” “highest score.” Any unseen row could belong before your current rows.
- **Pagination windows**
`page 2`, cursor windows, infinite scroll. Insertions/deletions before the window can shift membership.
- **Aggregates**
`count`, `sum`, `avg`, `min`, `max`, facets, unread counts. Partial rows produce confident wrong answers.
- **Negative queries**
`NOT EXISTS`, anti-joins, “has no comments,” “not tagged done,” “no open tasks.” Missing child rows create false positives.
- **Existence predicates over missing relations**
`where exists(comments...)`, `posts with any unread comment`. Missing children create false negatives.
- **Joins where the joined row determines membership**
`comments where post.categoryID = x`, `orders where customer.region = EU`.
- **OR / union across multiple indexes**
`assigned to me OR subscribed by me`. Complete only if every branch is covered.
- **Range queries over unbounded collections**
`createdAt between A and B`, `price < 100`, unless that range is explicitly covered.
- **Search / full-text / vector similarity**
Needs a complete index, not just rows.
- **Random / recommendation / ranking**
Anything algorithmic, personalized, or score-based usually needs server truth.
- **Permission-filtered queries**
If visibility can change server-side, local absence/presence may be stale unless synced or checked.