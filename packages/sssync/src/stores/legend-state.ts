import { type ObservableObject, observable } from "@legendapp/state";
import type { InMemoryStore, TableSchemas, TablesFromSchemas } from "../types";

export const createLegendStore = <Schemas extends TableSchemas>(
  initialData: TablesFromSchemas<Schemas>,
): InMemoryStore<Schemas> => {
  const data$ = observable(initialData) as ObservableObject<
    TablesFromSchemas<Schemas>
  >;

  return {
    get data() {
      return data$.get();
    },
    hydrate: (nextData) => {
      data$.set(nextData);
    },
    upsert: (tableName, row) => {
      const table = (data$ as any)[tableName];
      if (!table) {
        throw new Error(`Unknown table: ${String(tableName)}`);
      }
      const raw = table.peek() as Array<{ id: string }>;
      const index = raw.findIndex((existing: any) => existing?.id === row.id);
      if (index === -1) {
        table.push(row);
      } else {
        table[index].set(row);
      }
    },
    mutate: (actions) => {
      for (const action of actions) {
        const table = (data$ as any)[action.tableName];
        if (!table) {
          throw new Error(`Unknown table: ${action.tableName}`);
        }
        if (action.type === "create") {
          table.push(action.value);
          continue;
        }

        const raw = table.peek() as Array<{ id: string }>;
        const index = raw.findIndex((r: any) => r?.id === action.value.id);
        if (index === -1) {
          continue;
        }
        table[index].assign(action.value);
      }
    },
  };
};
