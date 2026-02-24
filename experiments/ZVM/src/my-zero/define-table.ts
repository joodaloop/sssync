import type { TableSchema } from "../../packages/zero-types/src/schema.ts";
import type { SchemaValue } from "../../packages/zero-types/src/schema-value.ts";
import type { TableBuilderWithColumns } from "../../packages/zero-schema/src/builder/table-builder.ts";
import { createSchema } from "../../packages/zero-schema/src/builder/schema-builder.ts";
import type { Relationships } from "../../packages/zero-schema/src/builder/relationship-builder.ts";

// ── Standard Schema V1 (inlined from @standard-schema/spec) ────────

interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
    readonly validate: (
      value: unknown,
    ) =>
      | { readonly value: Output; readonly issues?: undefined }
      | { readonly issues: ReadonlyArray<{ readonly message: string }> }
      | Promise<
          | { readonly value: Output; readonly issues?: undefined }
          | { readonly issues: ReadonlyArray<{ readonly message: string }> }
        >;
  };
}

export type { StandardSchemaV1 as SchemaValidator };

// ── Type-level helpers ─────────────────────────────────────────────

/**
 * Columns that need a runtime validator:
 * - json columns (type is "json")
 * - enumeration columns (type is "string" but customType is narrower than string)
 */
type NeedsValidator<V extends SchemaValue> = V extends {
  type: "json";
  customType: infer T;
}
  ? true
  : V extends { type: "string"; customType: infer T }
    ? string extends T
      ? false // plain string(), customType is just `string`
      : true // enumeration<"a" | "b">(), customType is narrower
    : false;

/** Extract the customType from a SchemaValue, falling back to unknown. */
type CustomTypeOf<V extends SchemaValue> = V extends { customType: infer T }
  ? T
  : unknown;

/**
 * The validators object: required for json/enum columns, mapping each
 * column name to a StandardSchemaV1 typed to the column's customType.
 */
type RequiredValidators<T extends TableSchema> =
  ValidatorKeys<T> extends never
    ? void | Record<string, never>
    : {
        [K in ValidatorKeys<T>]: StandardSchemaV1<unknown, CustomTypeOf<T["columns"][K]>>;
      };

type ValidatorKeys<T extends TableSchema> = {
  [K in keyof T["columns"]]: NeedsValidator<T["columns"][K]> extends true
    ? K
    : never;
}[keyof T["columns"]];

// ── SyncTable ──────────────────────────────────────────────────────

export type SyncTable<T extends TableSchema = TableSchema> = {
  readonly schema: T;
  readonly validators: Record<string, StandardSchemaV1>;
  readonly builder: TableBuilderWithColumns<T>;
};

/**
 * Wraps a zero-schema table definition with required validators for
 * json and enumeration columns.
 */
export function defineTable<T extends TableSchema>(
  tableBuilder: TableBuilderWithColumns<T>,
  ...args: RequiredValidators<T> extends void | Record<string, never>
    ? []
    : [validators: RequiredValidators<T>]
): SyncTable<T> {
  const schema = tableBuilder.build() as T;
  const validators = (args[0] ?? {}) as Record<string, StandardSchemaV1>;
  return { schema, validators, builder: tableBuilder };
}

/**
 * Creates a zero-schema from SyncTable definitions.
 * Eliminates the need to keep separate references to builders.
 */
export function createSyncSchema<
  const TTables extends readonly SyncTable[],
  const TRelationships extends readonly Relationships[],
>(options: {
  readonly tables: TTables;
  readonly relationships?: TRelationships | undefined;
}) {
  return createSchema({
    tables: options.tables.map((t) => t.builder) as any,
    relationships: options.relationships,
  });
}
