import type { InMemoryStore, TableSchemas, TablesFromSchemas } from "../types";

export const createDefaultStore = <Schemas extends TableSchemas>(
  initialData: TablesFromSchemas<Schemas>,
): InMemoryStore<Schemas> => {
  let data = initialData;
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
