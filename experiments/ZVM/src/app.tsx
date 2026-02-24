import { render } from "solid-js/web";
import { createSignal, onMount, For, Show } from "solid-js";
import { json, number, string, table } from "../packages/zero-schema/src/builder/table-builder.ts";
import { MyZero } from "./my-zero/my-zero.ts";
import { execSQL } from "./db.ts";
import { migrate } from "./my-zero/migrate.ts";
import { insert } from "./my-zero/crud.ts";
import { defineTable, createSyncSchema } from "./my-zero/define-table.ts";
import { hydrateFromSQLite } from "./my-zero/hydrate.ts";
import * as v from "valibot";

// ── Schema ──────────────────────────────────────────────────────────

const users = defineTable(
  table("users").columns({ id: number(), name: string(), interests: json<[]>() }).primaryKey("id"),
  { interests: v.tuple([]) },
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
  const [nextId, setNextId] = createSignal(100);
  const [migratedTables, setMigratedTables] = createSignal<string[]>([]);

  const usersQuery = zero.query().users;

  onMount(async () => {
    // 1. Migrate SQLite tables (creates/recreates if schema changed)
    const changed = await migrate(schema);
    setMigratedTables(changed);

    // 2. Seed sample data if tables were just created
    if (changed.includes("users")) {
      await insert(users, { id: 1, name: "Ada", interests: 3 });
      await insert(users, { id: 2, name: "Grace", interests: 5 });
      await insert(users, { id: 3, name: "Margaret", interests: 2 });
      await insert(issues, { id: 1, title: "Fix the thing", ownerId: 1, priority: 1 });
      await insert(issues, { id: 2, title: "Build the feature", ownerId: 2, priority: 2 });
    }

    // 3. Hydrate IVM from SQLite
    const { sql } = await hydrateFromSQLite(zero, "users", usersQuery, schema);
    setSqlText(sql);

    // 4. Find max id for generating new ids
    const maxRow = await execSQL("SELECT MAX(id) as maxId FROM users");
    const maxId = (maxRow[0]?.maxId as number) ?? 0;
    setNextId(maxId + 1);

    // 5. Materialize the query and wire up reactivity
    const view = zero.materialize(usersQuery);
    setData(view.data as any[]);
    view.addListener((d) => setData(d as any[]));

    setReady(true);
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
  }

  return (
    <div style={{ "font-family": "system-ui, sans-serif", padding: "2rem" }}>
      <h1>wa-sqlite + IVM Demo</h1>

      <Show when={ready()} fallback={<p>Loading SQLite worker...</p>}>
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
          <ul>
            <For each={data()}>
              {(user: any) => (
                <li>
                  {user.id}: {user.name}
                </li>
              )}
            </For>
          </ul>
          <button onClick={addUser}>Add User</button>
        </section>
      </Show>
    </div>
  );
}

render(() => <App />, document.getElementById("app")!);
