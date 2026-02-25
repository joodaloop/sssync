import type { Schema } from "../../packages/zero-types/src/schema.ts";
import type { TableSchema } from "../../packages/zero-types/src/schema.ts";
import type { Query } from "../../packages/zql/src/query/query.ts";
import { asQueryInternals } from "../../packages/zql/src/query/query-internals.ts";
import { zqlToSQL } from "../zql-to-sql.ts";
import { execSQL } from "../db.ts";
import type { MyZero } from "./my-zero.ts";

/**
 * Converts a row from SQLite storage types to the JSON-compatible types
 * that ZQL's MemorySource expects. This is the inverse of `prepareValue`
 * in crud.ts.
 *
 * SQLite stores booleans as 0/1 and JSON as stringified text, but ZQL
 * operates on plain JS values (true/false, parsed objects). The real Zero
 * sync engine sends already-parsed JSON over the wire so this conversion
 * isn't needed there — it only exists because we hydrate directly from SQLite.
 */
export function prepareForSource(
  tableSchema: TableSchema,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const columns = tableSchema.columns;
  for (const key in row) {
    const val = row[key];
    if (val === null || val === undefined) continue;
    const def = columns[key];
    if (def === undefined) continue;
    if (def.type === "boolean") row[key] = val === 1;
    else if (def.type === "json" && typeof val === "string") {
      row[key] = JSON.parse(val as string);
    }
  }
  return row;
}

/**
 * Hydrates the IVM pipeline for a table from SQLite.
 * Generates SQL from the ZQL query, runs it against SQLite,
 * and seeds the results into the MemorySource.
 *
 * Returns the generated SQL text for debugging/display.
 */
export async function hydrateFromSQLite<
  TSchema extends Schema,
  TTable extends keyof TSchema["tables"] & string,
  TReturn,
>(
  zero: MyZero<TSchema>,
  tableName: TTable,
  query: Query<TTable, TSchema, TReturn>,
  schema: TSchema,
): Promise<{ sql: string; values: readonly unknown[]; rowCount: number }> {
  const ast = asQueryInternals(query).ast;
  const { text, values } = zqlToSQL(schema, ast);

  const rows = await execSQL(text, values as unknown[]);
  const tableSchema = schema.tables[tableName];
  for (const row of rows) {
    prepareForSource(tableSchema, row as Record<string, unknown>);
  }
  zero.seed(tableName, rows as any[]);

  return { sql: text, values, rowCount: rows.length };
}
