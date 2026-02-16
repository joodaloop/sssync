import type { InMemoryStore, TableSchemas, TablesFromSchemas } from "../types";

const createTables = <Schemas extends TableSchemas>(tableSchemas: Schemas): TablesFromSchemas<Schemas> => {
  const entries = Object.keys(tableSchemas).map((key) => [key, []]);
  return Object.fromEntries(entries) as TablesFromSchemas<Schemas>;
};

export const createDefaultStore = <Schemas extends TableSchemas>(
  tableSchemas: Schemas,
): InMemoryStore<Schemas> => {
  let data = createTables(tableSchemas);
  return {
    get data() {
      return data;
    },
    hydrate: (nextData) => {
      data = nextData;
    },
    upsert: (tableName, row) => {
      const table = data[tableName];
      if (!table) {
        throw new Error(`Unknown table: ${String(tableName)}`);
      }
      const index = table.findIndex((existing) => existing?.id === row.id);
      if (index === -1) {
        table.push(row);
        return;
      }
      table[index] = row;
    },
    mutate: (actions) => {
      for (const action of actions) {
        const table = data[action.tableName];
        if (!table) {
          throw new Error(`Unknown table: ${action.tableName}`);
        }
        if (action.type === "create") {
          table.push(action.value);
          continue;
        }

        const index = table.findIndex((row) => row?.id === action.value.id);
        if (index === -1) {
          continue;
        }
        table[index] = { ...table[index], ...action.value };
      }
    },
  };
};
