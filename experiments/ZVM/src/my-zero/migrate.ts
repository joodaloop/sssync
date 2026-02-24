import type { Schema, TableSchema } from "../../packages/zero-types/src/schema.ts";
import type { ValueType } from "../../packages/zero-types/src/schema-value.ts";
import { execSQL, runSQL } from "../db.ts";

const META_TABLE = "_sync_meta";

const VALUE_TYPE_TO_SQLITE: Record<ValueType, string> = {
  string: "TEXT",
  number: "REAL",
  boolean: "INTEGER",
  null: "TEXT",
  json: "TEXT",
};

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

function hashTable(table: TableSchema): string {
  const serialized: Record<string, unknown> = {};
  for (const [col, def] of Object.entries(table.columns)) {
    serialized[col] = { type: def.type, optional: def.optional ?? false };
  }
  const canonical = JSON.stringify({
    columns: serialized,
    primaryKey: table.primaryKey,
  });
  return hashString(canonical);
}

export function createTableDDL(table: TableSchema): string {
  const colDefs: string[] = [];
  for (const [col, def] of Object.entries(table.columns)) {
    const sqliteType = VALUE_TYPE_TO_SQLITE[def.type];
    const nullable = def.optional ? "" : " NOT NULL";
    colDefs.push(`"${col}" ${sqliteType}${nullable}`);
  }
  const pk = table.primaryKey.map((k) => `"${k}"`).join(", ");
  colDefs.push(`PRIMARY KEY (${pk})`);
  return `CREATE TABLE "${table.name}" (${colDefs.join(", ")})`;
}

export async function migrate(schema: Schema): Promise<string[]> {
  await runSQL(`CREATE TABLE IF NOT EXISTS "${META_TABLE}" (
    table_name TEXT PRIMARY KEY,
    schema_hash TEXT NOT NULL
  )`);

  const changed: string[] = [];

  for (const [name, table] of Object.entries(schema.tables)) {
    const hash = hashTable(table);
    const rows = await execSQL(
      `SELECT schema_hash FROM "${META_TABLE}" WHERE table_name = ?`,
      [name],
    );

    if (rows[0]?.schema_hash === hash) continue;

    await runSQL(`DROP TABLE IF EXISTS "${name}"`);
    await runSQL(createTableDDL(table));
    await runSQL(
      `INSERT OR REPLACE INTO "${META_TABLE}" (table_name, schema_hash) VALUES (?, ?)`,
      [name, hash],
    );
    changed.push(name);
  }

  return changed;
}
