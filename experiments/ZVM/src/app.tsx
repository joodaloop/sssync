import { render } from "solid-js/web";
import { createSignal, onMount, For, Show } from "solid-js";
import { createSchema } from "../packages/zero-schema/src/builder/schema-builder.ts";
import { json, number, string, table } from "../packages/zero-schema/src/builder/table-builder.ts";
import { MyZero } from "./my-zero/my-zero.ts";
import { asQueryInternals } from "../packages/zql/src/query/query-internals.ts";
import { zqlToSQL } from "./zql-to-sql.ts";
import { execSQL } from "./db.ts";
import { migrate } from "./my-zero/migrate.ts";
import { insert } from "./my-zero/crud.ts";
import { defineTable } from "./my-zero/define-table.ts";
import * as v from "valibot";

// ── Schema ──────────────────────────────────────────────────────────

const usersBuilder = table("users").columns({ id: number(), name: string() }).primaryKey("id");

const issuesBuilder = table("issues")
  .columns({ id: number(), title: string(), ownerId: number(), tags: json<{ id: string }>() })
  .primaryKey("id");

const users = defineTable(usersBuilder);
const issues = defineTable(issuesBuilder, { tags: v.object({ id: v.string() }) });

const schema = createSchema({
  tables: [usersBuilder, issuesBuilder],
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
      await insert(users.schema, { id: 1, name: "Ada" });
      await insert(users.schema, { id: 2, name: "Grace" });
      await insert(users.schema, { id: 3, name: "Margaret" });
      await insert(issues.schema, { id: 1, title: "Fix the thing", ownerId: 1 });
      await insert(issues.schema, { id: 2, title: "Build the feature", ownerId: 2 });
    }

    // 3. Generate SQL from ZQL query
    const ast = asQueryInternals(usersQuery).ast;
    const { text, values } = zqlToSQL(schema, ast);
    setSqlText(text);

    // 4. Run the generated SQL against SQLite, seed IVM
    const rows = await execSQL(text, values as unknown[]);
    zero.seed("users", rows as any[]);

    // 5. Find max id for generating new ids
    const maxRow = await execSQL("SELECT MAX(id) as maxId FROM users");
    const maxId = (maxRow[0]?.maxId as number) ?? 0;
    setNextId(maxId + 1);

    // 6. Materialize the query and wire up reactivity
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

    const row = { id, name };

    // Persist in SQLite (validates against schema)
    await insert(users.schema, row);

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
