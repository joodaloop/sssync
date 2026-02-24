import { completeOrdering } from "../packages/zql/src/query/complete-ordering.ts";
import { transformFilters } from "../packages/zql/src/builder/filter.ts";
import {
  buildSelectQuery,
} from "../packages/zqlite/src/query-builder.ts";
import { format } from "../packages/zqlite/src/internal/sql.ts";
import type { AST } from "../packages/zero-protocol/src/ast.ts";
import type { Schema } from "../packages/zero-types/src/schema.ts";

/**
 * Given a schema and a ZQL AST, produce the equivalent SQLite query
 * (text + bound values).
 */
export function zqlToSQL(
  schema: Schema,
  ast: AST,
): { text: string; values: readonly unknown[] } {
  const completed = completeOrdering(ast, (tableName) => {
    return schema.tables[tableName].primaryKey;
  });

  const tableSchema = schema.tables[completed.table];
  const { filters } = transformFilters(completed.where);

  const sqlQuery = buildSelectQuery(
    completed.table,
    tableSchema.columns,
    undefined,
    filters,
    completed.orderBy!,
    false,
    undefined,
  );

  return format(sqlQuery);
}
