import {
  createSchema,
} from "../packages/zero-schema/src/builder/schema-builder.ts";
import {
  number,
  string,
  table,
} from "../packages/zero-schema/src/builder/table-builder.ts";
import { createBuilder } from "../packages/zql/src/query/create-builder.ts";
import { asQueryInternals } from "../packages/zql/src/query/query-internals.ts";
import { zqlToSQL } from "./zql-to-sql.ts";

// ── Same schema as my-zero-demo.ts ──────────────────────────────────

const users = table("users")
  .columns({ id: number(), name: string() })
  .primaryKey("id");

const issues = table("issues")
  .columns({ id: number(), title: string(), ownerId: number() })
  .primaryKey("id");

const schema = createSchema({ tables: [users, issues], relationships: [] });

// ── Extract SQL from the same query used in my-zero-demo.ts ─────────

const q = createBuilder(schema);

const queries = [
  { label: "users.limit(3)", query: q.users.limit(3) },
  { label: "issues (all)", query: q.issues },
  {
    label: 'users.where("name", "Ada")',
    query: q.users.where("name", "Ada"),
  },
];

for (const { label, query } of queries) {
  const ast = asQueryInternals(query).ast;
  const { text, values } = zqlToSQL(schema, ast);

  console.log(`\n── ${label} ──`);
  console.log("SQL:", text);
  if (values.length > 0) {
    console.log("Bindings:", values);
  }
}
