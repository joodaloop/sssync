import {
  createCollection,
  localOnlyCollectionOptions,
  type Collection,
  type Context,
  type InitialQueryBuilder,
  type QueryBuilder,
} from "@tanstack/db";
import { useLiveQuery } from "@tanstack/solid-db";

export type CollectionMap = Record<string, Collection<object, string | number>>;

type CollectionRow<TCollection> =
  TCollection extends Collection<infer TRow, string | number> ? TRow : never;
type CollectionKey<TCollection> =
  TCollection extends Collection<object, infer TKey> ? TKey : never;

type QueryFactory<TContext extends Context> = (
  builder: InitialQueryBuilder,
) => QueryBuilder<TContext> | undefined | null;

type LiveQueryInput<TContext extends Context> =
  | QueryFactory<TContext>
  | QueryBuilder<TContext>;
type SolidDbLiveQueryResult = ReturnType<typeof useLiveQuery<any>>;

export type CollectionMutationAction<TCollections extends CollectionMap> = {
  [TName in Extract<keyof TCollections, string>]:
    | {
        type: "insert";
        collection: TName;
        value: CollectionRow<TCollections[TName]>;
      }
    | {
        type: "upsert";
        collection: TName;
        value: CollectionRow<TCollections[TName]>;
      }
    | {
        type: "update";
        collection: TName;
        key: CollectionKey<TCollections[TName]>;
        value: Partial<CollectionRow<TCollections[TName]>>;
      }
    | {
        type: "delete";
        collection: TName;
        key: CollectionKey<TCollections[TName]>;
      };
}[Extract<keyof TCollections, string>];

export type CreateSolidIvmDatabaseOptions<TCollections extends CollectionMap> = {
  collections: TCollections;
};

export type SolidIvmDatabase<TCollections extends CollectionMap> = {
  collections: TCollections;
  insert: <TName extends Extract<keyof TCollections, string>>(
    collection: TName,
    value: CollectionRow<TCollections[TName]>,
  ) => void;
  upsert: <TName extends Extract<keyof TCollections, string>>(
    collection: TName,
    value: CollectionRow<TCollections[TName]>,
  ) => void;
  update: <TName extends Extract<keyof TCollections, string>>(
    collection: TName,
    key: CollectionKey<TCollections[TName]>,
    value: Partial<CollectionRow<TCollections[TName]>>,
  ) => void;
  delete: <TName extends Extract<keyof TCollections, string>>(
    collection: TName,
    key: CollectionKey<TCollections[TName]>,
  ) => void;
  apply: (actions: Array<CollectionMutationAction<TCollections>>) => void;
  replace: (
    snapshot: Partial<{
      [TName in Extract<keyof TCollections, string>]: Array<
        CollectionRow<TCollections[TName]>
      >;
    }>,
  ) => void;
  liveQuery: <TContext extends Context>(
    query: LiveQueryInput<TContext>,
  ) => SolidDbLiveQueryResult;
};

export type CreateCollectionDefinition<TRow extends object, TKey extends string | number> = {
  id?: string;
  getKey: (row: TRow) => TKey;
  initialData?: Array<TRow>;
};

export function createSolidIvmCollections<
  TDefinitions extends Record<
    string,
    CreateCollectionDefinition<object, string | number>
  >,
>(
  definitions: TDefinitions,
): {
  [TName in keyof TDefinitions]: Collection<
    TDefinitions[TName] extends CreateCollectionDefinition<infer TRow, any>
      ? TRow
      : never,
    TDefinitions[TName] extends CreateCollectionDefinition<any, infer TKey>
      ? TKey
      : never
  >;
} {
  const entries = Object.entries(definitions).map(([name, definition]) => {
    const localOnlyOptions = {
      id: definition.id ?? name,
      getKey: definition.getKey,
      ...(definition.initialData ? { initialData: definition.initialData } : {}),
    };

    const collection = createCollection(
      localOnlyCollectionOptions(localOnlyOptions),
    );

    return [name, collection] as const;
  });

  return Object.fromEntries(entries) as unknown as {
    [TName in keyof TDefinitions]: Collection<
      TDefinitions[TName] extends CreateCollectionDefinition<infer TRow, any>
        ? TRow
        : never,
      TDefinitions[TName] extends CreateCollectionDefinition<any, infer TKey>
        ? TKey
        : never
    >;
  };
}

export function createSolidIvmDatabase<TCollections extends CollectionMap>(
  options: CreateSolidIvmDatabaseOptions<TCollections>,
): SolidIvmDatabase<TCollections> {
  const getCollection = <TName extends Extract<keyof TCollections, string>>(
    collectionName: TName,
  ): TCollections[TName] => {
    const collection = options.collections[collectionName];
    if (!collection) {
      throw new Error(`Unknown collection: ${collectionName}`);
    }
    return collection;
  };

  const insert: SolidIvmDatabase<TCollections>["insert"] = (
    collectionName,
    value,
  ) => {
    const collection = getCollection(collectionName);
    collection.insert(value);
  };

  const upsert: SolidIvmDatabase<TCollections>["upsert"] = (
    collectionName,
    value,
  ) => {
    const collection = getCollection(collectionName);
    const key = collection.config.getKey(value);

    if (collection.has(key)) {
      collection.update(key, (draft) => {
        Object.assign(draft, value);
      });
      return;
    }

    collection.insert(value);
  };

  const update: SolidIvmDatabase<TCollections>["update"] = (
    collectionName,
    key,
    value,
  ) => {
    const collection = getCollection(collectionName);
    if (!collection.has(key)) {
      return;
    }

    collection.update(key, (draft) => {
      Object.assign(draft, value);
    });
  };

  const remove: SolidIvmDatabase<TCollections>["delete"] = (
    collectionName,
    key,
  ) => {
    const collection = getCollection(collectionName);
    if (!collection.has(key)) {
      return;
    }

    collection.delete(key);
  };

  const apply: SolidIvmDatabase<TCollections>["apply"] = (actions) => {
    for (const action of actions) {
      if (action.type === "insert") {
        insert(action.collection, action.value);
        continue;
      }
      if (action.type === "upsert") {
        upsert(action.collection, action.value);
        continue;
      }
      if (action.type === "update") {
        update(action.collection, action.key, action.value);
        continue;
      }
      remove(action.collection, action.key);
    }
  };

  const replace: SolidIvmDatabase<TCollections>["replace"] = (snapshot) => {
    for (const name of Object.keys(snapshot) as Array<
      Extract<keyof TCollections, string>
    >) {
      const rows = snapshot[name];
      if (!rows) {
        continue;
      }

      const collection = getCollection(name);
      const unseen = new Set(collection.keys());

      for (const row of rows) {
        const key = collection.config.getKey(row);
        unseen.delete(key);

        if (collection.has(key)) {
          collection.update(key, (draft) => {
            Object.assign(draft, row);
          });
        } else {
          collection.insert(row);
        }
      }

      if (unseen.size > 0) {
        collection.delete(Array.from(unseen));
      }
    }
  };

  function liveQuery<TContext extends Context>(
    query: LiveQueryInput<TContext>,
  ): SolidDbLiveQueryResult {
    if (typeof query === "function") {
      return useLiveQuery(query) as unknown as SolidDbLiveQueryResult;
    }

    return useLiveQuery(() => ({ query })) as unknown as SolidDbLiveQueryResult;
  }

  return {
    collections: options.collections,
    insert,
    upsert,
    update,
    delete: remove,
    apply,
    replace,
    liveQuery,
  };
}
