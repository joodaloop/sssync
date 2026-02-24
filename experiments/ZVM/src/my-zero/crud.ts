import type { ValueType } from "../../packages/zero-types/src/schema-value.ts";
import { runSQL } from "../db.ts";
import type { SyncTable } from "./define-table.ts";

type ValidationError = { column: string; expected: string; got: string };

function validateRow(
  syncTable: SyncTable,
  row: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const { schema, validators } = syncTable;

  for (const [col, def] of Object.entries(schema.columns)) {
    const val = row[col];

    if (val === undefined || val === null) {
      if (!def.optional) {
        errors.push({ column: col, expected: def.type, got: "missing" });
      }
      continue;
    }

    // Primitive type check
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

    // Rich validator for json/enum columns
    const validator = validators[col];
    if (validator) {
      const result = validator["~standard"].validate(val);
      if (result instanceof Promise) {
        throw new Error(
          `Async validators are not supported. Column "${col}" on table "${schema.name}" returned a Promise.`,
        );
      }
      if (result.issues) {
        const messages = result.issues.map((i) => i.message).join("; ");
        errors.push({ column: col, expected: "valid " + def.type, got: messages });
      }
    }
  }

  return errors;
}

function throwValidation(tableName: string, errors: ValidationError[]): never {
  throw new Error(
    `Validation failed for "${tableName}": ${errors.map((e) => `${e.column} (expected ${e.expected}, got ${e.got})`).join(", ")}`,
  );
}

function prepareValue(type: ValueType, val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (type === "json") return JSON.stringify(val);
  if (type === "boolean") return val ? 1 : 0;
  return val;
}

export async function insert(
  syncTable: SyncTable,
  row: Record<string, unknown>,
): Promise<void> {
  const errors = validateRow(syncTable, row);
  if (errors.length > 0) throwValidation(syncTable.schema.name, errors);

  const { schema } = syncTable;
  const cols = Object.keys(schema.columns).filter(
    (col) => row[col] !== undefined,
  );
  const values = cols.map((col) =>
    prepareValue(schema.columns[col].type, row[col]),
  );
  const placeholders = cols.map(() => "?").join(", ");
  const colNames = cols.map((c) => `"${c}"`).join(", ");

  await runSQL(
    `INSERT INTO "${schema.name}" (${colNames}) VALUES (${placeholders})`,
    values,
  );
}

export async function update(
  syncTable: SyncTable,
  row: Record<string, unknown>,
): Promise<void> {
  const errors = validateRow(syncTable, row);
  if (errors.length > 0) throwValidation(syncTable.schema.name, errors);

  const { schema } = syncTable;
  const pkCols = schema.primaryKey;
  const setCols = Object.keys(schema.columns).filter(
    (col) => !pkCols.includes(col) && row[col] !== undefined,
  );

  if (setCols.length === 0) return;

  const setClause = setCols.map((c) => `"${c}" = ?`).join(", ");
  const whereClause = pkCols.map((c) => `"${c}" = ?`).join(" AND ");

  const setValues = setCols.map((col) =>
    prepareValue(schema.columns[col].type, row[col]),
  );
  const pkValues = pkCols.map((col) =>
    prepareValue(schema.columns[col].type, row[col]),
  );

  await runSQL(
    `UPDATE "${schema.name}" SET ${setClause} WHERE ${whereClause}`,
    [...setValues, ...pkValues],
  );
}

export async function remove(
  syncTable: SyncTable,
  row: Record<string, unknown>,
): Promise<void> {
  const { schema } = syncTable;
  const pkCols = schema.primaryKey;

  for (const col of pkCols) {
    if (row[col] === undefined || row[col] === null) {
      throw new Error(
        `Missing primary key column "${col}" for delete on "${schema.name}"`,
      );
    }
  }

  const whereClause = pkCols.map((c) => `"${c}" = ?`).join(" AND ");
  const pkValues = pkCols.map((col) =>
    prepareValue(schema.columns[col].type, row[col]),
  );

  await runSQL(
    `DELETE FROM "${schema.name}" WHERE ${whereClause}`,
    pkValues,
  );
}
