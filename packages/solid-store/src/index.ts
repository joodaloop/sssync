import { createStore, produce, reconcile } from "solid-js/store";
import type { InMemoryStore, TableSchemas, TablesFromSchemas } from "sssync";

export const createSolidStore = <Schemas extends TableSchemas>(
  initialData: TablesFromSchemas<Schemas>,
): InMemoryStore<Schemas> => {
  const [data, setData] = createStore(initialData);

  return {
    get data() {
      return data;
    },
    hydrate: (nextData) => {
      setData(reconcile(nextData));
    },
    upsert: (tableName, row) => {
      setData(
        produce((draft) => {
          const table = draft[tableName];
          if (!table) {
            throw new Error(`Unknown table: ${String(tableName)}`);
          }
          const index = table.findIndex((existing) => existing?.id === row.id);
          if (index === -1) {
            table.push(row);
          } else {
            table[index] = reconcile(row)(table[index]);
          }
        }),
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
