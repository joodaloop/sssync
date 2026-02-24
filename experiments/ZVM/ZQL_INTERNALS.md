# ZQL Internals: Data Structures, Independence & Data Flow

A deep dive into how ZQL works internally, what it expects, how it outputs, and whether its subsystems are decoupled.

---

## 1. ZQL Module Independence

### Module Dependency Tree

```
zql/src/
├── query/          → DEPENDS ON: ivm, expression, builder
├── builder/        → DEPENDS ON: ivm, query, planner, filter
├── ivm/            → INDEPENDENT (leaf module)
├── planner/        → DEPENDS ON: nothing
├── mutate/         → INDEPENDENT (isolated)
└── error.ts        → INDEPENDENT
```

### Breakdown by Module

#### ✅ ivm/ (FULLY INDEPENDENT)
**What it imports:**
- `shared/` utilities
- `zero-protocol/` types only (AST, Row, Value, Ordering, Condition, PrimaryKey)
- `zero-types/` types only (SchemaValue, Comparator)

**What it does NOT import:**
- ❌ query/
- ❌ builder/
- ❌ planner/
- ❌ mutate/
- ❌ Anything else in zql/

**Verdict:** Pure data transformation layer. Can be used standalone.

---

#### ✅ planner/ (FULLY INDEPENDENT)
**What it imports:**
- `zero-protocol/` types (AST)
- `shared/` utilities

**What it does NOT import:**
- ❌ ivm/
- ❌ query/
- ❌ builder/
- ❌ mutate/

**Verdict:** Query plan optimizer. Transforms AST → optimized AST. No execution dependency.

---

#### ⚠️ query/ (DEPENDS ON ivm)
**What it imports:**
- ✅ `ivm/` → ViewFactory, View types
- ✅ `expression.ts` → ExpressionBuilder, conditions
- ❌ builder/ (only types!)
- ❌ planner/ (only types!)
- ❌ mutate/ (only for tests)

**Key types:**
- `Query<TTable, TSchema, TReturn>` - DSL interface
- `QueryDelegate` - Protocol for executing queries
- `ViewFactory<TTable, TSchema, TReturn, T>` - Custom view creators

**Verdict:** Query building & materialization. Depends on IVM for views, but NOT on builder.

---

#### ⚠️ builder/ (DEPENDS ON ivm + query)
**What it imports:**
- ✅ `ivm/` → Operators (Join, Filter, Take, etc.)
- ✅ `query/` → expression.ts, complete-ordering
- ✅ `planner/` → planQuery
- ❌ mutate/

**Key interface:**
- `BuilderDelegate` - Callbacks to provide sources & storage

**Verdict:** AST → operator pipeline compiler. Core of execution.

---

#### ✅ mutate/ (FULLY INDEPENDENT)
**What it imports:**
- `zero-protocol/` types
- `zero-types/` types
- `shared/` utilities

**What it does NOT import:**
- ❌ query/
- ❌ ivm/
- ❌ builder/
- ❌ planner/

**Verdict:** Mutation definition system. Completely isolated.

---

## 2. Core Data Structures

### Input/Output Streaming Model

**The fundamental contract:**

```typescript
// zql/src/ivm/operator.ts

export interface Input {
  getSchema(): SourceSchema;
  setOutput(output: Output): void;
  fetch(req: FetchRequest): Stream<Node | 'yield'>;
  destroy(): void;
}

export interface Output {
  push(change: Change, pusher: InputBase): Stream<'yield'>;
}

export interface Operator extends Input, Output {}
```

**Data Flow Pattern:**
```
Source.fetch(constraint, start, reverse) → Stream<Node>
  ↓
Operator A.fetch(...)  → Stream<Node>
  ↓
Operator B.fetch(...)  → Stream<Node>
  ↓
View reads nodes

[Asynchronously]
Source.push(change) → propagates to all Output implementations
                       operators apply incrementally
                       View updates reactively
```

### Node: Row + Lazy Relationships

```typescript
// zql/src/ivm/data.ts

export type Node = {
  row: Row;  // Actual data: {userId: '1', name: 'Alice', ...}
  relationships: Record<string, () => Stream<Node | 'yield'>>;
};
```

**Why lazy relationships?**
- Not all relationship data may be needed
- Subqueries are generated on-demand
- Saves memory for large result sets

**Example:**
```typescript
const node: Node = {
  row: {postId: '1', userId: '2', title: 'Hello'},
  relationships: {
    'user': () => stream([
      {row: {userId: '2', name: 'Bob'}, relationships: {}}
    ])
  }
};

// Access only when needed
const users = Array.from(node.relationships.user());
```

---

### Changes: Add/Remove/Edit + Child Changes

```typescript
// zql/src/ivm/change.ts

export type Change = AddChange | RemoveChange | EditChange | ChildChange;

// A row was added to result
export type AddChange = {type: 'add'; node: Node};

// A row was removed from result  
export type RemoveChange = {type: 'remove'; node: Node};

// Row data changed (e.g., score updated)
export type EditChange = {
  type: 'edit';
  node: Node;      // New state
  oldNode: Node;   // Old state
};

// A descendant changed (e.g., child record updated)
export type ChildChange = {
  type: 'child';
  node: Node;      // Parent (unchanged)
  child: {
    relationshipName: string;
    change: Change;  // Recursive: can be Add/Remove/Edit/Child
  };
};
```

**Edit splits:**
Edit changes can split into Add+Remove if:
1. Row becomes filtered out (edit → remove)
2. Row comes into result after edit
3. Row position changes in ordering

---

### View: Materialized Result

```typescript
// zql/src/ivm/view.ts

export type View = EntryList | Entry | undefined;
export type EntryList = readonly Entry[];
export type Entry = {readonly [key: string]: Value | View};

// View is recursive - can nest relationships
```

**Example:**
```typescript
// For query: from('posts')
//              .join('users', ...)
//              .select(['title', 'user.name'])

const view: View = [
  {
    title: 'First Post',
    user: {
      name: 'Alice'
    }
  },
  {
    title: 'Second Post',
    user: {
      name: 'Bob'
    }
  }
];
```

---

### SourceSchema: Metadata About Data

```typescript
// zql/src/ivm/schema.ts

export type SourceSchema = {
  readonly tableName: string;
  readonly columns: Record<string, SchemaValue>;
  readonly primaryKey: PrimaryKey;
  readonly relationships: {[key: string]: SourceSchema};
  readonly isHidden: boolean;
  readonly system: System;  // 'client' | 'server' | 'permissions'
  readonly compareRows: Comparator;
  readonly sort: Ordering;
};
```

---

### Stream: Lazy Generator-Based Protocol

```typescript
// zql/src/ivm/stream.ts

export type Stream<T> = Iterable<T>;  // Just an iterable!

// Common utilities:
export function consume<T>(stream: Stream<T>): void {
  for (const _ of stream);  // Force evaluation
}

export function first<T>(stream: Stream<T>): T | undefined {
  const it = stream[Symbol.iterator]();
  const {value} = it.next();
  it.return?.();
  return value;
}
```

**Why generators/streams?**
- Lazy evaluation - don't compute until needed
- Responsive - can yield control for UI rendering
- Memory efficient - one row at a time
- Backpressure - consumer controls pace

**Special value: `'yield'`**
```typescript
// An operator can yield control mid-stream
function* expensiveOperation() {
  for (let i = 0; i < 1000000; i++) {
    yield row;
    if (i % 100 === 0) {
      yield 'yield';  // Let browser render
    }
  }
}
```

---

### SourceChange: Raw CRUD from Source

```typescript
// zql/src/ivm/source.ts

export type SourceChangeAdd = {
  type: 'add';
  row: Row;
};

export type SourceChangeRemove = {
  type: 'remove';
  row: Row;
};

export type SourceChangeEdit = {
  type: 'edit';
  row: Row;
  oldRow: Row;  // Needed for tracking what changed in ordering
};

export type SourceChange = SourceChangeAdd | SourceChangeRemove | SourceChangeEdit;
```

**Source interface:**
```typescript
export interface Source {
  get tableSchema(): TableSchema;
  
  connect(
    sort: Ordering,
    filters?: Condition,
    splitEditKeys?: Set<string>
  ): SourceInput;

  push(change: SourceChange): Stream<'yield'>;
  genPush(change: SourceChange): Stream<'yield' | undefined>;
}
```

---

## 3. Execution Flow: AST → Results

### Phase 1: Building the Pipeline

```
User Query (TypeScript DSL)
  ↓
QueryImpl (AST wrapper)
  ↓
buildPipeline(ast, delegate)
  ├─ Validate ordering includes primary key
  ├─ Optional: Run planner for optimization
  └─ buildPipelineInternal()
      ├─ For each table in AST: delegate.getSource(tableName)
      ├─ For each operator: create Input/Output chain
      │   - Filter → Filter operator
      │   - Join → Join operator
      │   - Exists → Exists operator (fan-out/fan-in)
      │   - Take/Skip → Take/Skip operators
      │   - etc.
      └─ Return root Input (connect to final Output)
```

### Phase 2: Initial Data Fetch

```
query.run() / query.materialize()
  ↓
buildPipeline() creates Input chain
  ↓
View factory creates Output (e.g., ArrayView)
  ↓
View.setInput(root)
  ↓
For each operator chain:
  input.fetch(FetchRequest)
    ├─ operator chains fetch() downward
    ├─ Source.fetch() returns all rows (sorted, filtered)
    └─ Propagates up: rows flow through filters, joins, etc.
  ↓
View receives nodes via push()
  ├─ Expands lazy relationships
  ├─ Deduplicates by deep equality
  ├─ Maintains sorted order
  └─ Updates internal state
```

### Phase 3: Incremental Updates

```
Source.push(SourceChange)
  ├─ Stores change in overlay
  ├─ For each connected operator output:
  │   └─ push(change) propagates downward
  │       ├─ Each operator:
  │       │  ├─ Applies change to internal state
  │       │  ├─ Emits resulting Change (may split/combine)
  │       │  └─ Passes to output
  │       └─ View receives Change
  │           ├─ Applies to materialized view
  │           ├─ Notifies listeners
  │           └─ Returns Stream<'yield'>
  └─ Consumer can yield control for responsiveness
```

---

## 4. Key Algorithms & Internal State

### Sorting & Ordering Constraints

**Every query MUST have complete ordering:**

```typescript
// zql/src/query/complete-ordering.ts

export function completeOrdering(
  ast: AST,
  getPK: (tableName: string) => PrimaryKey
): AST {
  // If ORDER BY doesn't include primary key, add it
  // Required so Source can return sorted, deduplicatable rows
}
```

**Why?**
- Primary key makes rows globally unique
- Ordering enables correct join semantics
- Deduplication works on sorted lists

---

### Join Implementation: Sorted Iteration + Hash Lookup

```typescript
// zql/src/ivm/join.ts (simplified)

class Join implements Operator {
  // Maintains two sorted lists with hash index on join key
  #leftRows: Map<JoinKey, Node[]>;
  #rightRows: Map<JoinKey, Node[]>;

  push(change: Change) {
    // When row added: 
    // 1. Lookup matching rows in other side via hash
    // 2. Generate cross product of matches
    // 3. Emit Change for each match
    
    // When row removed:
    // 1. Lookup matching rows
    // 2. Emit Remove for each match
    
    // When row edited:
    // 1. If join key changed: remove old matches + add new
    // 2. If join key same: emit Edit for all matches
  }
}
```

---

### Filter: Predicate Application

```typescript
// zql/src/ivm/filter.ts

class Filter implements Operator {
  #predicate: (row: Row) => boolean;

  push(change: Change) {
    // Test predicate on row
    if (change.type === 'add') {
      if (predicate(change.node.row)) {
        output.push(change);  // Pass through
      }
      // else: silently drop
    }
    if (change.type === 'remove') {
      if (predicate(change.oldNode.row)) {
        output.push(change);  // Was visible, now remove
      }
    }
    if (change.type === 'edit') {
      const wasVisible = predicate(change.oldNode.row);
      const isVisible = predicate(change.node.row);
      
      if (wasVisible && isVisible) {
        output.push(change);  // Still visible, just edit
      } else if (wasVisible) {
        output.push({type: 'remove', node: change.oldNode});
      } else if (isVisible) {
        output.push({type: 'add', node: change.node});
      }
      // else: wasn't visible, still isn't
    }
  }
}
```

---

### Take/Skip: Window Management

```typescript
// zql/src/ivm/take.ts (simplified)

class Take implements Operator {
  #limit: number;
  #offset: number;
  #rows: Node[] = [];  // Internal sorted array

  fetch() {
    // Return only rows[offset:offset+limit]
  }

  push(change: Change) {
    // When row added:
    // - If it's in [offset, offset+limit]: emit Add
    // - If it's before offset: shift window, may emit Remove at end
    // - If it's after offset+limit: ignore
    
    // Tricky: row edits that move position require Remove+Add
  }
}
```

---

### View Materialization: Incremental Updates

```typescript
// zql/src/ivm/array-view.ts

class ArrayView<V extends View> implements Output {
  #data: Entry[] = [];
  #root: Entry = {'': this.#data};  // Synthetic root

  push(change: Change) {
    switch (change.type) {
      case 'add':
        // 1. Expand lazy relationships eagerly
        const expanded = expandNode(change.node);
        // 2. Binary search to find position in sorted array
        const idx = binarySearch(this.#data, expanded);
        // 3. Insert at position
        this.#data.splice(idx, 0, expanded);
        // 4. Notify listeners
        this.#listeners.forEach(l => l(this.#data));
        break;
      
      case 'remove':
        // 1. Find by deep equality
        const removeIdx = this.#data.findIndex(e => deepEqual(e, expanded));
        // 2. Remove
        this.#data.splice(removeIdx, 1);
        // 3. Notify
        this.#listeners.forEach(l => l(this.#data));
        break;
      
      case 'edit':
        // Similar: remove old, insert new at correct position
        break;
      
      case 'child':
        // Recursively apply change to nested view
        break;
    }
  }
}
```

---

## 5. Query → Pipeline Mapping

### Simple Query

```typescript
const query = createBuilder(schema)
  .from('posts')
  .where(c => c.score.gt(100))
  .orderBy(c => c.createdAt)
  .take(10);
```

**Becomes AST:**
```typescript
{
  table: 'posts',
  condition: {op: '>', left: {table: 'posts', col: 'score'}, right: {lit: 100}},
  orderBy: [{col: 'createdAt', dir: 'asc'}, {col: 'id', dir: 'asc'}],
  limit: 10
}
```

**Becomes Pipeline:**
```
MemorySource('posts')
  │
  └─ Filter(score > 100)
      │
      └─ Take(limit=10, offset=0)
          │
          └─ ArrayView
```

### Join Query

```typescript
const query = createBuilder(schema)
  .from('posts')
  .innerJoin('users', c => c.userId.eq(c.posts.userId))
  .where(c => c.users.score.gt(100))
  .orderBy(c => c.posts.createdAt);
```

**Becomes Pipeline:**
```
MemorySource('posts')          MemorySource('users')
  │                                     │
  └─ Filter(score > 100)        (no filter needed)
      │                              │
      └────────── Join(userId=userId ──┘
                      │
                      └─ ArrayView
```

---

## 6. Query Builder Independence

### Query Building (NO Execution)

```typescript
// Pure DSL building - returns AST, doesn't execute anything

const q1 = createBuilder(schema)
  .from('posts')
  .where(c => c.score.gt(100));

// At this point: NO pipeline built, NO operators created
// Just a Query object wrapping an AST

const ast = asQueryInternals(q1).ast;  // {table: 'posts', condition: ...}
```

### Execution Trigger

```typescript
// EXECUTION happens here:

// Option 1: Run and get snapshot
const results = await q1.run(delegate);

// Option 2: Materialize with live updates
const view = q1.materialize(delegate);
view.listen(newView => console.log(newView));

// Both require a delegate providing getSource(), createStorage()
```

---

## 7. Summary: Independence Within ZQL

| Component | Independence | Key Export | Depends On |
|-----------|--------------|-----------|-----------|
| ivm/ | ✅ Complete | Input, Output, Operator | zero-protocol, shared |
| planner/ | ✅ Complete | planQuery() | zero-protocol, shared |
| query/ | ⚠️ Partial | Query, QueryDelegate, ViewFactory | ivm, expression |
| builder/ | ⚠️ Partial | buildPipeline() | ivm, query, planner |
| mutate/ | ✅ Complete | Mutator, defineMutator() | zero-protocol, shared |
| expression.ts | ✅ Complete | ExpressionBuilder, cmp, and, or | zero-protocol, shared |

---

## 8. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   APPLICATION LAYER                          │
│  (Framework: React, Solid, custom)                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   QUERY INTERFACE (query/)                   │
│  • createBuilder()  → QueryImpl (wraps AST)                  │
│  • QueryImpl.run()   → Promise<results>                      │
│  • QueryImpl.materialize() → View<results>                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│               QUERY EXECUTION (builder/)                     │
│  • buildPipeline(AST, delegate)                             │
│  • Delegates provide: getSource(), createStorage()          │
│  • Compiles AST → Operator pipeline                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│         INCREMENTAL VIEW MAINTENANCE (ivm/)                  │
│  • Source → MemorySource stores rows                        │
│  • Operators: Filter, Join, Take, Skip, Exists, etc.       │
│  • Changes: Add/Remove/Edit/Child propagate down            │
│  • View: ArrayView materializes + notifies                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  APPLICATION STORAGE                         │
│  (MemorySource, or custom Source implementation)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Custom Implementation Example

**You can implement custom:**

1. **Custom Source** (replace MemorySource)
```typescript
class PostgreSQLSource implements Source {
  tableSchema = ...;
  
  connect(sort, filters) {
    return new PostgreSQLInput(this, sort, filters);
  }
  
  push(change: SourceChange) {
    // Propagate to DB
    // Return stream
  }
}
```

2. **Custom View** (replace ArrayView)
```typescript
const customView = query.materialize(
  (query, input, format, onDestroy, onCommit, queryComplete, updateTTL) => {
    // Create custom reactive object (Solid signal, React state, etc.)
    // Return it
    return myReactiveObject;
  }
);
```

3. **Custom QueryDelegate**
```typescript
class CustomDelegate extends QueryDelegateBase {
  override createStorage() {
    return new CustomStorage();
  }
  
  override getSource(name: string): Source {
    return mySourceMap.get(name);
  }
  
  override batchViewUpdates<T>(apply: () => T): T {
    return batchWithMyFramework(() => apply());
  }
}
```

---

## Key Takeaway

**ZQL is modular but not hermetic:**
- ✅ IVM is completely standalone
- ✅ Planner is completely standalone  
- ⚠️ Query layer depends on IVM for view materialization
- ⚠️ Builder depends on query + IVM
- ✅ Mutate is completely isolated

**You can use:**
- IVM alone (manual operator pipeline)
- Query + IVM (DSL + full engine)
- Query alone (just building, not executing)
- Custom operators (implement Input/Output)
- Custom sources (implement Source)
- Custom views (provide ViewFactory)
