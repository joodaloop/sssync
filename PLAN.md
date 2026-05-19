Code-understanding & code-quality infra

  Things that help you see and improve the library itself:

  Static analysis & dead code
  - Knip — finds unused exports, files, deps, and types. Run as knip
  --production to see what's actually reachable from your entry point. Brutal
  and fantastic for a young library where APIs are still settling.
  - ts-prune / tsr (Type-aware tree-shaker analyzer) — narrower than Knip, just
  unused exports.
  - madge — visualizes the module dependency graph and detects circular deps.
  madge --circular --extensions ts src/ in CI. Circular deps in a sync library
  will bite you.
  - dependency-cruiser — more powerful than madge: you write rules ("nothing in
  schema/ may import from runtime/") and they're enforced in CI. Great for
  keeping the library's layering honest as it grows.

  Coverage that's actually useful
  - Bun's --coverage or @vitest/coverage-v8. The trick: enable branch coverage,
  not line, and look at the uncovered branches in core files rather than chasing
   %. For a sync engine, the value is "which conflict-resolution paths have I
  never exercised."
  - Mutation testing with Stryker — flips operators in your code and checks if
  tests catch it. Slow, but the highest-signal way to know your tests are real.
  Worth running weekly on the core, not every PR.

  Property-based & fuzz testing (high value for sync/CRDT-ish code)
  - fast-check — generate random op sequences, assert convergence/idempotence
  properties. This is the single highest-ROI testing tool for a library like
  yours. Even a handful of properties (e.g., "any reordering of independent ops
  produces the same state") catches bugs unit tests never will.
  - Snapshot the model: state-machine testing via fast-check's fc.commands is
  purpose-built for sync logic.

  Type-level rigor
  - expect-type or tsd — assert the types your public API exposes. For a library
   whose generics carry the value (looks like yours does — TableSchema,
  SchemaValueToTSType), this is more important than runtime tests.
  - @arethetypeswrong/cli runs locally too, not just for publishing — it
  surfaces type-resolution issues you can't see otherwise.
  - Tighten tsconfig: exactOptionalPropertyTypes, noUncheckedIndexedAccess,
  noPropertyAccessFromIndexSignature, noImplicitOverride. Each one flushes out a
   class of latent bugs.

  Performance visibility
  - mitata or tinybench benchmarks committed alongside the code, run locally.
  Even without CI integration, having bun run bench show throughput on common
  ops keeps you honest as the implementation evolves.
  - clinic.js / Node --cpu-prof for one-off profiling sessions. Bun has
  --inspect with the Chrome profiler.
  - why-is-node-running equivalent in Bun, or node --trace-warnings for leaked
  timers/handles — useful if you spawn workers or hold sockets.

  Runtime invariants
  - A custom invariant(cond, msg) that's a no-op in production builds (stripped
  via define/drop in your bundler). Lets you assert internal state aggressively
  in dev without paying the cost at runtime.
  - tinyassert or roll your own. The discipline of writing invariants surfaces
  design issues — if you can't state an invariant clearly, the module is
  probably tangled.

  Architecture visibility
  - tsr + madge --image graph.svg + the bundle-size script you already have = a
  tight feedback loop on "is this library staying simple?"
  - A short ARCHITECTURE.md listing the layers and what may depend on what. Pair
   with dependency-cruiser rules so it's enforced, not aspirational.
