import { createStore, produce, reconcile } from "solid-js/store";
import type { InMemoryStore, TableSchemas, TablesFromSchemas } from "../types";

const createTables = <Schemas extends TableSchemas>(tableSchemas: Schemas): TablesFromSchemas<Schemas> => {
  const entries = Object.keys(tableSchemas).map((key) => [key, []]);
  return Object.fromEntries(entries) as TablesFromSchemas<Schemas>;
};

export const createSolidStore = <Schemas extends TableSchemas>(
  tableSchemas: Schemas,
): InMemoryStore<Schemas> => {
  const [data, setData] = createStore(createTables(tableSchemas));

  return {
    get data() {
      return data;
    },
    hydrate: (nextData) => {
      setData(reconcile(nextData));
    },
    upsert: (tableName, row) => {
      const table = data[tableName];
      if (!table) {
        throw new Error(`Unknown table: ${String(tableName)}`);
      }
      const index = table.findIndex((existing) => existing?.id === row.id);
      const nextTable = [...table];
      if (index === -1) {
        nextTable.push(row);
      } else {
        nextTable[index] = row;
      }
      (setData as (key: string, value: unknown) => void)(
        tableName,
        reconcile(nextTable) as unknown as TablesFromSchemas<Schemas>[keyof TablesFromSchemas<Schemas>],
      );
    },
    mutate: (actions) => {
      setData(
        produce((draft) => {
          for (const action of actions) {
            const table = draft[action.tableName];
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
        }),
      );
    },
  };
};
