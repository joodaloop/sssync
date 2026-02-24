import type { TableSchema } from "../../packages/zero-types/src/schema.ts";
import type { ValueType } from "../../packages/zero-types/src/schema-value.ts";
import { runSQL } from "../db.ts";

type ValidationError = { column: string; expected: ValueType; got: string };

function validateRow(
  table: TableSchema,
  row: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [col, def] of Object.entries(table.columns)) {
    const val = row[col];

    if (val === undefined || val === null) {
      if (!def.optional) {
        errors.push({ column: col, expected: def.type, got: "missing" });
      }
      continue;
    }

    switch (def.type) {
      case "string":
        if (typeof val !== "string")
          errors.push({ column: col, expected: "string", got: typeof val });
        break;
      case "number":
        if (typeof val !== "number")
          errors.push({ column: col, expected: "number", got: typeof val });
        break;
      case "boolean":
        if (typeof val !== "boolean")
          errors.push({ column: col, expected: "boolean", got: typeof val });
        break;
      case "json":
        try {
          JSON.stringify(val);
        } catch {
          errors.push({ column: col, expected: "json", got: "non-serializable" });
        }
        break;
      case "null":
        break;
    }
  }

  return errors;
}

function prepareValue(type: ValueType, val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (type === "json") return JSON.stringify(val);
  if (type === "boolean") return val ? 1 : 0;
  return val;
}

export async function insert(
  table: TableSchema,
  row: Record<string, unknown>,
): Promise<void> {
  const errors = validateRow(table, row);
  if (errors.length > 0) {
    throw new Error(
      `Validation failed for "${table.name}": ${errors.map((e) => `${e.column} (expected ${e.expected}, got ${e.got})`).join(", ")}`,
    );
  }

  const cols = Object.keys(table.columns).filter(
    (col) => row[col] !== undefined,
  );
  const values = cols.map((col) =>
    prepareValue(table.columns[col].type, row[col]),
  );
  const placeholders = cols.map(() => "?").join(", ");
  const colNames = cols.map((c) => `"${c}"`).join(", ");

  await runSQL(
    `INSERT INTO "${table.name}" (${colNames}) VALUES (${placeholders})`,
    values,
  );
}

export async function update(
  table: TableSchema,
  row: Record<string, unknown>,
): Promise<void> {
  const errors = validateRow(table, row);
  if (errors.length > 0) {
    throw new Error(
      `Validation failed for "${table.name}": ${errors.map((e) => `${e.column} (expected ${e.expected}, got ${e.got})`).join(", ")}`,
    );
  }

  const pkCols = table.primaryKey;
  const setCols = Object.keys(table.columns).filter(
    (col) => !pkCols.includes(col) && row[col] !== undefined,
  );

  if (setCols.length === 0) return;

  const setClause = setCols.map((c) => `"${c}" = ?`).join(", ");
  const whereClause = pkCols.map((c) => `"${c}" = ?`).join(" AND ");

  const setValues = setCols.map((col) =>
    prepareValue(table.columns[col].type, row[col]),
  );
  const pkValues = pkCols.map((col) =>
    prepareValue(table.columns[col].type, row[col]),
  );

  await runSQL(
    `UPDATE "${table.name}" SET ${setClause} WHERE ${whereClause}`,
    [...setValues, ...pkValues],
  );
}

export async function remove(
  table: TableSchema,
  row: Record<string, unknown>,
): Promise<void> {
  const pkCols = table.primaryKey;

  for (const col of pkCols) {
    if (row[col] === undefined || row[col] === null) {
      throw new Error(
        `Missing primary key column "${col}" for delete on "${table.name}"`,
      );
    }
  }

  const whereClause = pkCols.map((c) => `"${c}" = ?`).join(" AND ");
  const pkValues = pkCols.map((col) =>
    prepareValue(table.columns[col].type, row[col]),
  );

  await runSQL(
    `DELETE FROM "${table.name}" WHERE ${whereClause}`,
    pkValues,
  );
}

