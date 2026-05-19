/* oxlint-disable @typescript-eslint/no-explicit-any */
import type { Relationship, TableSchema } from './table-schema';
import type { Relationships } from './relationship-builder';
import { type TableBuilderWithColumns } from './table-builder';

/**
 * Note: the keys of the `tables` and `relationships` parameters do not matter.
 * You can assign them to any value you like. E.g.,
 *
 * ```ts
 * createSchema({rsdfgafg: table('users')...}, {sdfd: relationships(users, ...)})
 * ```
 */
export function createSchema<
  const TTables extends readonly TableBuilderWithColumns<TableSchema>[],
  const TRelationships extends readonly Relationships[],
  const TEnableLegacyQueries extends boolean | undefined,
  const TEnableLegacyMutators extends boolean | undefined,
>(options: {
  readonly tables: TTables;
  readonly relationships?: TRelationships | undefined;
  readonly enableLegacyQueries?: TEnableLegacyQueries | undefined;
  readonly enableLegacyMutators?: TEnableLegacyMutators | undefined;
}): {
  tables: {
    readonly [K in TTables[number]['schema']['name']]: Extract<
      TTables[number]['schema'],
      { name: K }
    >;
  };
  relationships: {
    readonly [K in TRelationships[number]['name']]: Extract<
      TRelationships[number],
      { name: K }
    >['relationships'];
  };
  enableLegacyQueries: TEnableLegacyQueries;
  enableLegacyMutators: TEnableLegacyMutators;
} {
  const retTables: Record<string, TableSchema> = {};
  const retRelationships: Record<string, Record<string, Relationship>> = {};
  const serverNames = new Set<string>();

  options.tables.forEach(table => {
    const { serverName = table.schema.name } = table.schema;
    if (serverNames.has(serverName)) {
      throw new Error(`Multiple tables reference the name "${serverName}"`);
    }
    serverNames.add(serverName);
    if (Object.hasOwn(retTables, table.schema.name)) {
      throw new Error(
        `Table "${table.schema.name}" is defined more than once in the schema`,
      );
    }
    retTables[table.schema.name] = table.build();
  });
  options.relationships?.forEach(relationships => {
    if (retRelationships[relationships.name]) {
      throw new Error(
        `Relationships for table "${relationships.name}" are defined more than once in the schema`,
      );
    }
    retRelationships[relationships.name] = relationships.relationships;
    checkRelationship(
      relationships.relationships,
      relationships.name,
      retTables,
    );
  });

  return {
    tables: retTables,
    relationships: retRelationships,
    enableLegacyQueries: options.enableLegacyQueries,
    enableLegacyMutators: options.enableLegacyMutators,
  } as any;
}

function checkRelationship(
  relationships: Record<string, Relationship>,
  tableName: string,
  tables: Record<string, TableSchema>,
) {
  // TS should be able to check this for us but something is preventing it from happening.
  Object.entries(relationships).forEach(([name, rel]) => {
    let source = tables[tableName];
    if (source.columns[name] !== undefined) {
      throw new Error(
        `Relationship "${tableName}"."${name}" cannot have the same name as the column "${name}" on the the table "${source.name}"`,
      );
    }
    rel.forEach(connection => {
      if (!tables[connection.destSchema]) {
        throw new Error(
          `For relationship "${tableName}"."${name}", destination table "${connection.destSchema}" is missing in the schema`,
        );
      }
      if (!source.columns[connection.sourceField[0]]) {
        throw new Error(
          `For relationship "${tableName}"."${name}", the source field "${connection.sourceField[0]}" is missing in the table schema "${source.name}"`,
        );
      }
      source = tables[connection.destSchema];
    });
  });
}
