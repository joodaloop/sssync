import {
  IR,
  Query,
  compileQuery,
  createCollection,
  localOnlyCollectionOptions,
  type ChangeMessage,
  type Collection,
  type Context,
  type InitialQueryBuilder,
  type KeyedStream,
  type QueryBuilder,
} from "@tanstack/db";
import { D2, MultiSet, output, type MultiSetArray } from "@tanstack/db-ivm";
import { batch } from "solid-js";
import { createStore, type SetStoreFunction } from "solid-js/store";

export type CollectionMap = Record<string, Collection<object, string | number>>;

type QueryIR = IR.QueryIR;

type CollectionRow<TCollection> =
  TCollection extends Collection<infer TRow, string | number> ? TRow : never;
type CollectionKey<TCollection> =
  TCollection extends Collection<object, infer TKey> ? TKey : never;

type QueryBuilderWithIR = {
  _getQuery: () => QueryIR;
};

type QueryFactory = (builder: InitialQueryBuilder) => QueryBuilder<Context>;

type QueryInput = QueryIR | QueryBuilderWithIR | QueryFactory;

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

export type LiveQueryState<TResult> = {
  records: Record<string, TResult | undefined>;
  order: Array<string>;
};

export type LiveQueryStore<TResult> = {
  data: LiveQueryState<TResult>;
  rows: () => Array<TResult>;
  dispose: () => void;
};

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
  liveQuery: <TResult = unknown>(query: QueryInput) => LiveQueryStore<TResult>;
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

  function liveQuery<TResult = unknown>(query: QueryInput): LiveQueryStore<TResult> {
    const queryIR = toQueryIR(query);
    const collectionsById = collectCollectionsFromQuery(queryIR);
    const graph = new D2();
    const inputs: Record<string, ReturnType<D2["newInput"]>> = {};

    for (const alias of getSourceAliases(queryIR)) {
      inputs[alias] = graph.newInput<[string | number, unknown]>();
    }

    const compiled = compileQuery(
      queryIR,
      inputs as unknown as Record<string, KeyedStream>,
      collectionsById,
      {},
      {},
      new Set(),
      {},
      () => undefined,
    );

    const [state, setState] = createStore<LiveQueryState<TResult>>({
      records: {},
      order: [],
    });

    const multiplicities = new Map<string, number>();
    const orderTokens = new Map<string, string | undefined>();
    const isOrderedQuery = Boolean(queryIR.orderBy && queryIR.orderBy.length > 0);

    compiled.pipeline.pipe(
      output((data) => {
        applyOutputBatch({
          data,
          setState,
          multiplicities,
          orderTokens,
          isOrderedQuery,
        });
      }),
    );

    graph.finalize();

    const disposers: Array<() => void> = [];

    for (const [alias, collectionId] of Object.entries(compiled.aliasToCollectionId)) {
      const collection = collectionsById[collectionId];
      if (!collection) {
        throw new Error(`Collection not found for alias: ${alias}`);
      }

      const whereExpression = compiled.sourceWhereClauses.get(alias);
      const subscriptionOptions = whereExpression
        ? { includeInitialState: true, whereExpression }
        : { includeInitialState: true };

      const subscription = collection.subscribeChanges((changes) => {
        const input = inputs[alias];
        if (!input) {
          throw new Error(`Missing input stream for alias: ${alias}`);
        }

        const nextData = changesToMultiSet(changes, collection.config.getKey);
        if (nextData.getInner().length === 0) {
          return;
        }

        input.sendData(nextData);
        graph.run();
      }, subscriptionOptions);

      disposers.push(() => {
        subscription.unsubscribe();
      });
    }

    return {
      get data() {
        return state;
      },
      rows: () => {
        const rows: Array<TResult> = [];
        for (const key of state.order) {
          const row = state.records[key];
          if (row !== undefined) {
            rows.push(row);
          }
        }
        return rows;
      },
      dispose: () => {
        for (const dispose of disposers) {
          dispose();
        }
      },
    };
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

type BatchedChange<TResult> = {
  delta: number;
  value: TResult | undefined;
  orderToken: string | undefined;
};

type ApplyOutputBatchOptions<TResult> = {
  data: MultiSet<[unknown, [TResult, string | undefined]]>;
  setState: SetStoreFunction<LiveQueryState<TResult>>;
  multiplicities: Map<string, number>;
  orderTokens: Map<string, string | undefined>;
  isOrderedQuery: boolean;
};

function applyOutputBatch<TResult>(options: ApplyOutputBatchOptions<TResult>): void {
  const pending = new Map<string, BatchedChange<TResult>>();

  for (const [[rawKey, [value, orderToken]], multiplicity] of options.data.getInner()) {
    const key = serializeStoreKey(rawKey);
    const current = pending.get(key) ?? {
      delta: 0,
      value: undefined,
      orderToken: undefined,
    };

    current.delta += multiplicity;
    if (multiplicity > 0) {
      current.value = value;
      current.orderToken = orderToken;
    }

    pending.set(key, current);
  }

  if (pending.size === 0) {
    return;
  }

  batch(() => {
    for (const [key, change] of pending) {
      const previousMultiplicity = options.multiplicities.get(key) ?? 0;
      const nextMultiplicity = previousMultiplicity + change.delta;

      if (nextMultiplicity <= 0) {
        options.multiplicities.delete(key);
        options.orderTokens.delete(key);
        options.setState("records", key, undefined);
        options.setState("order", (previousOrder) =>
          previousOrder.filter((entry) => entry !== key),
        );
        continue;
      }

      options.multiplicities.set(key, nextMultiplicity);

      if (change.value !== undefined) {
        options.setState("records", key, change.value);
      }

      const existingToken = options.orderTokens.get(key);
      if (change.orderToken !== undefined || existingToken === undefined) {
        options.orderTokens.set(key, change.orderToken);
      }

      const currentToken = options.orderTokens.get(key);
      const shouldReposition =
        options.isOrderedQuery && existingToken !== currentToken;

      if (previousMultiplicity <= 0) {
        options.setState("order", (previousOrder) =>
          insertInOrder(previousOrder, key, currentToken, options.orderTokens),
        );
        continue;
      }

      if (shouldReposition) {
        options.setState("order", (previousOrder) => {
          const withoutKey = previousOrder.filter((entry) => entry !== key);
          return insertInOrder(withoutKey, key, currentToken, options.orderTokens);
        });
      }
    }
  });
}

function insertInOrder(
  currentOrder: Array<string>,
  key: string,
  token: string | undefined,
  orderTokens: Map<string, string | undefined>,
): Array<string> {
  if (currentOrder.includes(key)) {
    return currentOrder;
  }

  const ordered = [...currentOrder];
  let index = ordered.length;

  for (let i = 0; i < ordered.length; i += 1) {
    const existingKey = ordered[i];
    if (!existingKey) {
      continue;
    }

    const existingToken = orderTokens.get(existingKey);
    if (compareOrderTokens(token, existingToken) < 0) {
      index = i;
      break;
    }
  }

  ordered.splice(index, 0, key);
  return ordered;
}

function compareOrderTokens(
  left: string | undefined,
  right: string | undefined,
): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return left < right ? -1 : 1;
}

function changesToMultiSet<TRow extends object, TKey extends string | number>(
  changes: Array<ChangeMessage<TRow, TKey>>,
  getKey: (item: TRow) => TKey,
): MultiSet<[TKey, TRow]> {
  const entries: MultiSetArray<[TKey, TRow]> = [];

  for (const change of changes) {
    const key = getKey(change.value);

    if (change.type === "insert") {
      entries.push([[key, change.value], 1]);
      continue;
    }

    if (change.type === "update") {
      if (change.previousValue) {
        entries.push([[key, change.previousValue], -1]);
      }
      entries.push([[key, change.value], 1]);
      continue;
    }

    entries.push([[key, change.value], -1]);
  }

  return new MultiSet(entries);
}

function toQueryIR(query: QueryInput): QueryIR {
  if (isQueryIR(query)) {
    return query;
  }

  if (isQueryBuilderWithIR(query)) {
    return query._getQuery();
  }

  const builtQuery = query(new Query());
  if (!isQueryBuilderWithIR(builtQuery)) {
    throw new Error("Query callback must return a TanStack DB query builder");
  }

  return builtQuery._getQuery();
}

function isQueryIR(value: unknown): value is QueryIR {
  return (
    typeof value === "object" &&
    value !== null &&
    "from" in value &&
    !("_getQuery" in value)
  );
}

function isQueryBuilderWithIR(value: unknown): value is QueryBuilderWithIR {
  return (
    typeof value === "object" &&
    value !== null &&
    "_getQuery" in value &&
    typeof value._getQuery === "function"
  );
}

function collectCollectionsFromQuery(queryIR: QueryIR): Record<string, Collection> {
  const collectionsById: Record<string, Collection> = {};
  collectCollectionRefs(queryIR, collectionsById);
  return collectionsById;
}

function collectCollectionRefs(
  queryIR: QueryIR,
  collectionsById: Record<string, Collection>,
): void {
  collectSource(queryIR.from, collectionsById);

  if (!queryIR.join || queryIR.join.length === 0) {
    return;
  }

  for (const join of queryIR.join) {
    collectSource(join.from, collectionsById);
  }
}

function collectSource(
  source: QueryIR["from"],
  collectionsById: Record<string, Collection>,
): void {
  if (source.type === "collectionRef") {
    collectionsById[source.collection.id] = source.collection;
    return;
  }

  collectCollectionRefs(source.query, collectionsById);
}

function getSourceAliases(queryIR: QueryIR): Array<string> {
  const aliases = new Set<string>();
  collectAliases(queryIR, aliases);
  return Array.from(aliases);
}

function collectAliases(queryIR: QueryIR, aliases: Set<string>): void {
  collectAliasFromSource(queryIR.from, aliases);

  if (!queryIR.join) {
    return;
  }

  for (const join of queryIR.join) {
    collectAliasFromSource(join.from, aliases);
  }
}

function collectAliasFromSource(
  source: QueryIR["from"],
  aliases: Set<string>,
): void {
  aliases.add(source.alias);

  if (source.type === "queryRef") {
    collectAliases(source.query, aliases);
  }
}

function serializeStoreKey(key: unknown): string {
  if (typeof key === "string") {
    return `string:${key}`;
  }
  if (typeof key === "number") {
    return `number:${key}`;
  }
  if (typeof key === "bigint") {
    return `bigint:${String(key)}`;
  }
  if (typeof key === "boolean") {
    return `boolean:${String(key)}`;
  }
  if (key === null) {
    return "null";
  }
  if (typeof key === "undefined") {
    return "undefined";
  }

  return `json:${JSON.stringify(key)}`;
}
