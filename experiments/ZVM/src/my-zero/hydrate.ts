import type { Schema } from "../../packages/zero-types/src/schema.ts";
import type { Query } from "../../packages/zql/src/query/query.ts";
import { asQueryInternals } from "../../packages/zql/src/query/query-internals.ts";
import { zqlToSQL } from "../zql-to-sql.ts";
import { execSQL } from "../db.ts";
import type { MyZero } from "./my-zero.ts";

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
  zero.seed(tableName, rows as any[]);

  return { sql: text, values, rowCount: rows.length };
}
