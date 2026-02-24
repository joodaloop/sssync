import type { TableSchema } from "../../packages/zero-types/src/schema.ts";
import type { SchemaValue } from "../../packages/zero-types/src/schema-value.ts";
import type { TableBuilderWithColumns } from "../../packages/zero-schema/src/builder/table-builder.ts";

/** Minimal Standard Schema V1 validator interface, typed to its output. */
type SchemaValidator<Output = unknown> = {
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (
      value: unknown,
    ) =>
      | { value: Output; issues?: undefined }
      | { issues: readonly { message: string }[] }
      | Promise<
          | { value: Output; issues?: undefined }
          | { issues: readonly { message: string }[] }
        >;
  };
};

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
 * column name to a SchemaValidator typed to the column's customType.
 */
type RequiredValidators<T extends TableSchema> =
  ValidatorKeys<T> extends never
    ? void | Record<string, never>
    : {
        [K in ValidatorKeys<T>]: SchemaValidator<CustomTypeOf<T["columns"][K]>>;
      };

type ValidatorKeys<T extends TableSchema> = {
  [K in keyof T["columns"]]: NeedsValidator<T["columns"][K]> extends true
    ? K
    : never;
}[keyof T["columns"]];

export type SyncTable<T extends TableSchema = TableSchema> = {
  readonly schema: T;
  readonly validators: Record<string, SchemaValidator>;
};

/**
 * Wraps a zero-schema table definition with required validators for
 * json and enumeration columns.
 *
 * Usage:
 *   const usersTable = defineTable(users, {
 *     settings: v.object({ theme: v.string() }),
 *     mood: v.picklist(["happy", "sad"]),
 *   });
 */
export function defineTable<T extends TableSchema>(
  tableBuilder: TableBuilderWithColumns<T>,
  ...args: RequiredValidators<T> extends void | Record<string, never>
    ? []
    : [validators: RequiredValidators<T>]
): SyncTable<T> {
  const schema = tableBuilder.build() as T;
  const validators = (args[0] ?? {}) as Record<string, SchemaValidator>;
  return { schema, validators };
}
