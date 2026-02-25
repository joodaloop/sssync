import { render } from "solid-js/web";
import { createSignal, onMount, For, Show } from "solid-js";
import { json, number, string, table } from "../packages/zero-schema/src/builder/table-builder.ts";
import { MyZero } from "./my-zero/my-zero.ts";
import { execSQL, resetDatabase } from "./db.ts";
import { migrate } from "./my-zero/migrate.ts";
import { insert } from "./my-zero/crud.ts";
import { defineTable, createSyncSchema, type SyncTableFor } from "./my-zero/define-table.ts";
import * as v from "valibot";

// ── Schema ──────────────────────────────────────────────────────────

const users = defineTable(
  table("users").columns({ id: number(), name: string(), interests: number() }).primaryKey("id"),
);

const issues = defineTable(
  table("issues").columns({ id: number(), title: string(), ownerId: number(), priority: number() }).primaryKey("id"),
);

const schema = createSyncSchema({
  tables: [users, issues],
  relationships: [],
});

// ── Zero instance ───────────────────────────────────────────────────

const zero = new MyZero(schema);

// ── App ─────────────────────────────────────────────────────────────

function App() {
  const [ready, setReady] = createSignal(false);
  const [sqlText, setSqlText] = createSignal("");
  const [data, setData] = createSignal<any[]>([]);
  const [sourceRowCount, setSourceRowCount] = createSignal(0);
  const [nextId, setNextId] = createSignal(100);
  const [error, setError] = createSignal("");
  const [hasAddedSecondQuery, setHasAddedSecondQuery] = createSignal(false);
  const [migratedTables, setMigratedTables] = createSignal<string[]>([]);

  const initialUsersQuery = zero.query().users.where("interests", "<=", 3);
  const secondUsersQuery = zero.query().users.where("interests", ">=", 4);
  let secondQueryUnsubscribe: (() => void) | undefined;

  const getUsersSourceRowCount = () => {
    let count = 0;
    for (const _row of zero.registerTable("users").data) {
      count++;
    }
    return count;
  };

  onMount(async () => {
    try {
      // 1. Migrate SQLite tables (creates/recreates if schema changed)
      const changed = await migrate(schema);
      setMigratedTables(changed);

      // 2. Seed sample data if empty
      const existing = await execSQL("SELECT COUNT(*) as cnt FROM users");
      if ((existing[0]?.cnt as number) === 0) {
        await insert(users, { id: 1, name: "Ada", interests: 3 });
        await insert(users, { id: 2, name: "Grace", interests: 5 });
        await insert(users, { id: 3, name: "Margaret", interests: 2 });
        await insert(issues, { id: 1, title: "Fix the thing", ownerId: 1, priority: 1 });
        await insert(issues, { id: 2, title: "Build the feature", ownerId: 2, priority: 2 });
      }

      // 3. Observe automatic hydrations for display
      zero.onHydrated((event) => {
        setSqlText((previous) =>
          [
            previous,
            previous ? "" : "",
            `Auto hydration for query ${event.queryHash.slice(0, 8)}... on ${event.tableName}:`,
            event.sql,
            `Rows fetched: ${event.rowCount}`,
          ].join("\n"),
        );
        setSourceRowCount(getUsersSourceRowCount());
      });

      // 4. Find max id for generating new ids
      const maxRow = await execSQL("SELECT MAX(id) as maxId FROM users");
      const maxId = (maxRow[0]?.maxId as number) ?? 0;
      setNextId(maxId + 1);

      // 5. Materialize only the first query. This will auto-hydrate interests <= 3.
      const view = zero.materialize(initialUsersQuery);
      setData(view.data as any[]);
      view.addListener((d) => {
        setData(d as any[]);
        setSourceRowCount(getUsersSourceRowCount());
      });

      setSourceRowCount(getUsersSourceRowCount());

      setReady(true);
    } catch (e: any) {
      console.error("Init failed:", e);
      setError(e.message);
    }
  });

  const names = ["Hedy", "Radia", "Barbara", "Frances", "Adele", "Karen", "Anita", "Fran", "Sophie", "Marian"];

  async function addUser() {
    const id = nextId();
    const name = names[id % names.length];
    setNextId(id + 1);

    const row = { id, name, interests: Math.floor(Math.random() * 10) };

    // Persist in SQLite (validates against schema + rich validators)
    await insert(users, row);

    // Ingest into IVM (instant UI update)
    zero.ingest("users", { type: "add", row });
    setSourceRowCount(getUsersSourceRowCount());
  }

  function addSecondQueryToPipeline() {
    if (secondQueryUnsubscribe) {
      return;
    }
    secondQueryUnsubscribe = zero.subscribeChanges(secondUsersQuery, () => {
      setSourceRowCount(getUsersSourceRowCount());
    });
    setHasAddedSecondQuery(true);
  }

  return (
    <div style={{ "font-family": "system-ui, sans-serif", padding: "2rem" }}>
      <h1>wa-sqlite + IVM Demo</h1>

      <Show when={error()}>
        <p style={{ color: "red" }}>Error: {error()}</p>
      </Show>

      <Show when={ready()} fallback={!error() && <p>Loading SQLite worker...</p>}>
        <Show when={migratedTables().length > 0}>
          <p style={{ color: "#666", "font-style": "italic" }}>Migrated tables: {migratedTables().join(", ")}</p>
        </Show>

        <section>
          <h2>Generated SQL (from ZQL)</h2>
          <pre
            style={{
              background: "#f0f0f0",
              padding: "1rem",
              "border-radius": "4px",
              overflow: "auto",
            }}
          >
            {sqlText()}
          </pre>
        </section>

        <section>
          <h2>Users</h2>
          <p style={{ color: "#444" }}>
            The visible list is <code>users.where("interests", "&lt;=", 3)</code>. Hydration now happens automatically
            when queries are materialized/subscribed. Adding the second query below should grow the same shared{" "}
            <code>users</code> source.
          </p>
          <p>
            Shared source row count: <strong>{sourceRowCount()}</strong>
          </p>
          <ul>
            <For each={data()}>
              {(user: any) => (
                <li>
                  {user.id}: {user.name} (interests: {user.interests})
                </li>
              )}
            </For>
          </ul>
          <button onClick={addSecondQueryToPipeline} disabled={hasAddedSecondQuery()}>
            Add second query to pipeline (interests &gt;= 4)
          </button>{" "}
          <button onClick={addUser}>Add User</button>{" "}
          <button onClick={resetDatabase} style={{ color: "red" }}>
            Reset Database
          </button>
        </section>
      </Show>
    </div>
  );
}

render(() => <App />, document.getElementById("app")!);
