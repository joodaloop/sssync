import type { SchemaValue } from './schema-value';

/**
 * Primary key definition - a readonly array with at least one string element.
 * First element is the primary key field, additional elements form composite keys.
 */
export type PrimaryKey = readonly [string, ...string[]];

export type TableSchema = {
  readonly name: string;
  readonly serverName?: string | undefined;
  readonly columns: Record<string, SchemaValue>;
  readonly primaryKey: PrimaryKey;
};

export type RelationshipsSchema = {
  readonly [name: string]: Relationship;
};

export type Cardinality = 'one' | 'many';

type Connection = {
  readonly sourceField: readonly string[];
  readonly destField: readonly string[];
  readonly destSchema: string;
  readonly cardinality: Cardinality;
};

export type Relationship =
  | readonly [Connection]
  | readonly [Connection, Connection];

export type LastInTuple<T extends Relationship> = T extends readonly [infer L]
  ? L
  : T extends readonly [unknown, infer L]
    ? L
    : T extends readonly [unknown, unknown, infer L]
      ? L
      : never;

/**
 * Top-level schema definition.
 * Contains table definitions, relationships, and feature flags.
 */
export type Schema = {
  readonly tables: { readonly [table: string]: TableSchema };
  readonly relationships: { readonly [table: string]: RelationshipsSchema };
  readonly enableLegacyQueries?: boolean | undefined;
  readonly enableLegacyMutators?: boolean | undefined;
};
