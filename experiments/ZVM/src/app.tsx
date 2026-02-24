import { render } from "solid-js/web";
import { createSignal, onMount, For, Show } from "solid-js";
import {
  createSchema,
} from "../packages/zero-schema/src/builder/schema-builder.ts";
import {
  number,
  string,
  table,
} from "../packages/zero-schema/src/builder/table-builder.ts";
import { MyZero } from "./my-zero/my-zero.ts";
import { asQueryInternals } from "../packages/zql/src/query/query-internals.ts";
import { zqlToSQL } from "./zql-to-sql.ts";
import { execSQL, runSQL } from "./db.ts";

// ── Schema ──────────────────────────────────────────────────────────

const users = table("users")
  .columns({ id: number(), name: string() })
  .primaryKey("id");

const issues = table("issues")
  .columns({ id: number(), title: string(), ownerId: number() })
  .primaryKey("id");

const schema = createSchema({ tables: [users, issues], relationships: [] });

// ── Zero instance ───────────────────────────────────────────────────

const zero = new MyZero(schema);

// ── App ─────────────────────────────────────────────────────────────

function App() {
  const [ready, setReady] = createSignal(false);
  const [sqlText, setSqlText] = createSignal("");
  const [data, setData] = createSignal<any[]>([]);
  const [nextId, setNextId] = createSignal(100);

  const usersQuery = zero.query().users;

  onMount(async () => {
    // 1. Create tables in SQLite (via worker)
    await runSQL(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);
    await runSQL(`
      CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        ownerId INTEGER NOT NULL
      )
    `);

    // 2. Seed sample data if empty
    const existing = await execSQL("SELECT COUNT(*) as cnt FROM users");
    if ((existing[0]?.cnt as number) === 0) {
      await runSQL(
        "INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Grace'), (3, 'Margaret')",
      );
      await runSQL(
        "INSERT INTO issues (id, title, ownerId) VALUES (1, 'Fix the thing', 1), (2, 'Build the feature', 2)",
      );
    }

    // 3. Generate SQL from ZQL query
    const ast = asQueryInternals(usersQuery).ast;
    const { text, values } = zqlToSQL(schema, ast);
    setSqlText(text);

    // 4. Run the generated SQL against SQLite
    const rows = await execSQL(text, values as unknown[]);

    // 5. Seed IVM pipeline from SQLite results
    zero.seed("users", rows as any[]);

    // 6. Find the max id for generating new ids
    const maxRow = await execSQL("SELECT MAX(id) as maxId FROM users");
    const maxId = (maxRow[0]?.maxId as number) ?? 0;
    setNextId(maxId + 1);

    // 7. Materialize the query and wire up reactivity
    const view = zero.materialize(usersQuery);
    setData(view.data as any[]);
    view.addListener((d) => setData(d as any[]));

    setReady(true);
  });

  const names = [
    "Hedy", "Radia", "Barbara", "Frances", "Adele",
    "Karen", "Anita", "Fran", "Sophie", "Marian",
  ];

  async function addUser() {
    const id = nextId();
    const name = names[id % names.length];
    setNextId(id + 1);

    // Persist in SQLite
    await runSQL("INSERT INTO users (id, name) VALUES (?, ?)", [id, name]);

    // Ingest into IVM (instant UI update)
    zero.ingest("users", { type: "add", row: { id, name } });
  }

  return (
    <div style={{ "font-family": "system-ui, sans-serif", padding: "2rem" }}>
      <h1>wa-sqlite + IVM Demo</h1>

      <Show when={ready()} fallback={<p>Loading SQLite worker...</p>}>
        <section>
          <h2>Generated SQL (from ZQL)</h2>
          <pre style={{
            background: "#f0f0f0",
            padding: "1rem",
            "border-radius": "4px",
            overflow: "auto",
          }}>
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
