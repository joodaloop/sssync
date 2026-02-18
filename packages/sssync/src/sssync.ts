import { type IDBPDatabase, openDB } from "idb";
import * as v from "valibot";
import {
  createTables,
  type EventDefinitions,
  type EventEnvelope,
  type EventKey,
  type EventPayload,
  type MaterializerAction,
  type MaterializerContext,
  type MaterializerMap,
  type RawEvent,
  type SyncResponse,
  type InMemoryStore,
  type TableSchemas,
  type TablesFromSchemas,
} from "./types";
import { QueryCache } from "./cache/query-cache";
import { createDefaultStore } from "./stores/default";

type QueryCacheEntry<Result> = {
  key: string;
  value: Result;
  updatedAt: number;
};

type MetaEntry = {
  key: "instance";
  value: {
    id: string;
    createdAt: number;
  };
};

type DataEntry = {
  key: string;
  value: unknown;
};

const STORE_NAMES = {
  data: "data",
  queryCache: "query_cache",
  mutationLog: "mutation_log",
  meta: "meta",
} as const;

export class SSSync<Definitions extends EventDefinitions, Schemas extends TableSchemas> {
  readonly id: string;
  private readonly store: InMemoryStore<Schemas>;
  private readonly eventDefinitions: Definitions;
  private readonly materializers: MaterializerMap<Schemas, Definitions>;
  private readonly events: Array<EventEnvelope<Definitions[keyof Definitions]>>;
  private readonly queryCache: QueryCache<unknown>;
  private readonly dbPromise: Promise<IDBPDatabase<unknown>>;
  private readonly tableSchemas: Schemas;
  readonly ready: Promise<void>;
  private initialized = false;
  private leader = false;
  private releaseLeadership?: () => void;
  private readonly channel: BroadcastChannel | undefined;
  private readonly rescanChannel: BroadcastChannel | undefined;
  private readonly syncResponseSchema: v.BaseSchema<unknown, SyncResponse<Schemas>, unknown>;
  private readonly broadcastEnvelopeSchema: v.BaseSchema<unknown, EventEnvelope<Definitions[keyof Definitions]>, unknown>;

  constructor(
    id: string,
    events: Definitions,
    materializers: MaterializerMap<Schemas, Definitions>,
    tableSchemas: Schemas,
    store?: InMemoryStore<Schemas>,
  ) {
    this.id = id;
    this.eventDefinitions = events;
    this.materializers = materializers;
    this.tableSchemas = tableSchemas;
    this.store = store ?? createDefaultStore(createTables(tableSchemas));
    this.events = [];
    this.queryCache = new QueryCache();
    this.dbPromise = this.openDatabase();
    this.ready = this.initialize();
    this.channel = this.createChannel();
    this.rescanChannel = this.createRescanChannel();
    this.syncResponseSchema = this.createSyncResponseSchema(tableSchemas);
    this.broadcastEnvelopeSchema = this.createEnvelopeSchema(events);
    this.attachChannelListeners();
    this.attachRescanListeners();
    this.startLeaderElection();
  }

  get isLeader(): boolean {
    return this.leader;
  }

  get tables(): TablesFromSchemas<Schemas> {
    return this.store.data;
  }

  commit(events: RawEvent<Definitions>[]): EventEnvelope<Definitions[keyof Definitions]>[] {
    if (!this.initialized) {
      throw new Error("SSSync is not ready yet.");
    }
    const applied = events.map((event) => this.applyEvent(event));
    const envelopes = applied.map((entry) => entry.envelope);
    const actions = applied.flatMap((entry) => entry.actions);
    const rescanKeys = this.collectRescanKeys(applied);
    this.events.push(...envelopes);
    void this.writeMutations(envelopes);
    if (this.leader) {
      void this.persistActions(actions).then(() => {
        this.broadcastRescanKeys(rescanKeys);
      });
    }
    return envelopes;
  }

  async query(path: string, now = Date.now()): Promise<SyncResponse<Schemas>> {
    const cached = this.queryCache.get(["query", path]) as SyncResponse<Schemas> | null;
    if (cached !== null) {
      return cached;
    }

    await this.ready;
    const database = await this.dbPromise;
    const stored = (await database.get(STORE_NAMES.queryCache, path)) as
      | QueryCacheEntry<SyncResponse<Schemas>>
      | undefined;
    if (stored) {
      const validated = this.queryCache.setValidated(
        ["query", path],
        stored.value,
        this.syncResponseSchema,
        stored.updatedAt,
      );
      return validated;
    }

    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Query failed: ${response.status} ${response.statusText}`);
    }
    const result = (await response.json()) as unknown;
    const validated = this.queryCache.setValidated(["query", path], result, this.syncResponseSchema, now);
    await database.put(STORE_NAMES.queryCache, {
      key: path,
      value: validated,
      updatedAt: now,
    } satisfies QueryCacheEntry<SyncResponse<Schemas>>);
    this.broadcastQueryResult(validated);
    return validated;
  }

  private createSyncResponseSchema(tableSchemas: Schemas): v.BaseSchema<unknown, SyncResponse<Schemas>, unknown> {
    const tableEntries = Object.entries(tableSchemas).map(([name, schema]) => [name, v.array(schema)]);
    const tablesSchema = v.object(Object.fromEntries(tableEntries));
    const actionOptions = Object.keys(tableSchemas).flatMap((tableName) => {
      const schema = tableSchemas[tableName as keyof Schemas];
      const updateValueSchema = v.required(v.partial(schema), ["id"]);
      return [
        v.object({
          type: v.literal("create"),
          tableName: v.literal(tableName),
          value: schema,
        }),
        v.object({
          type: v.literal("update"),
          tableName: v.literal(tableName),
          value: updateValueSchema,
        }),
      ];
    });
    const actionsSchema = v.array(v.union(actionOptions));
    return v.union([
      v.object({
        mode: v.literal("snapshot"),
        data: tablesSchema,
      }),
      v.object({
        mode: v.literal("actions"),
        data: actionsSchema,
      }),
    ]);
  }

  private createEnvelopeSchema(
    events: Definitions,
  ): v.BaseSchema<unknown, EventEnvelope<Definitions[keyof Definitions]>, unknown> {
    const eventSchemas = Object.entries(events).map(([name, definition]) =>
      v.object({
        id: v.string(),
        name: v.literal(definition.name),
        payload: definition.schema,
        timestamp: v.number(),
      }),
    );
    return v.union(eventSchemas) as v.BaseSchema<
      unknown,
      EventEnvelope<Definitions[keyof Definitions]>,
      unknown
    >;
  }

  private async initialize(): Promise<void> {
    await this.ensureMetaRow();
    await this.loadTables();
    this.initialized = true;
  }

  private createChannel(): BroadcastChannel | undefined {
    if (typeof BroadcastChannel === "undefined") {
      return undefined;
    }
    return new BroadcastChannel(`sssync:${this.id}`);
  }

  private createRescanChannel(): BroadcastChannel | undefined {
    if (typeof BroadcastChannel === "undefined") {
      return undefined;
    }
    return new BroadcastChannel(`${this.id}_rescan`);
  }

  private attachChannelListeners(): void {
    if (!this.channel) {
      return;
    }

    this.channel.addEventListener("message", (event) => {
      const data = this.parseBroadcastMessage(event.data);
      if (!data || data.type !== "mutation") {
        return;
      }
      if (!this.leader) {
        return;
      }
      void this.handleRemoteMutation(data.envelope);
    });
  }

  private attachRescanListeners(): void {
    if (!this.rescanChannel) {
      return;
    }

    this.rescanChannel.addEventListener("message", (event) => {
      const data = event.data as { key?: string } | string | undefined;
      const key = typeof data === "string" ? data : data?.key;
      if (!key) {
        return;
      }
      void this.rescan(key);
    });
  }

  private startLeaderElection(): void {
    if (typeof navigator === "undefined" || !("locks" in navigator)) {
      return;
    }

    navigator.locks.request(`sssync:${this.id}`, async () => {
      this.setLeader(true);
      await new Promise<void>((resolve) => {
        this.releaseLeadership = () => {
          this.setLeader(false);
          resolve();
        };
      });
    });
  }

  private setLeader(value: boolean): void {
    this.leader = value;
    this.channel?.postMessage({ type: "leader", id: this.id, leader: value });
  }

  private sendMutation(envelope: EventEnvelope<Definitions[keyof Definitions]>): void {
    this.channel?.postMessage({ type: "mutation", id: this.id, envelope });
  }

  private broadcastRescanKey(key: string): void {
    this.rescanChannel?.postMessage({ key });
  }

  private broadcastRescanKeys(keys: Set<string>): void {
    for (const key of keys) {
      this.broadcastRescanKey(key);
    }
  }

  private collectRescanKeys(applied: Array<AppliedEvent<Schemas, Definitions>>): Set<string> {
    const keys = new Set<string>();
    for (const entry of applied) {
      for (const key of entry.rescanKeys) {
        keys.add(key);
      }
    }
    return keys;
  }

  private async handleRemoteMutation(
    envelope: EventEnvelope<Definitions[keyof Definitions]>,
  ): Promise<void> {
    await this.ready;
    await this.persistMutation(envelope);
    const rawEvent = this.toRawEvent(envelope);
    if (!rawEvent) {
      return;
    }
    const applied = this.applyEvent(rawEvent);
    await this.persistActions(applied.actions);
    this.broadcastRescanKeys(applied.rescanKeys);
  }

  private parseBroadcastMessage(
    payload: unknown,
  ): { type: "mutation"; envelope: EventEnvelope<Definitions[keyof Definitions]> } | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const { type, envelope } = payload as { type?: unknown; envelope?: unknown };
    if (type !== "mutation") {
      return null;
    }
    const validated = v.safeParse(this.broadcastEnvelopeSchema, envelope);
    if (!validated.success) {
      return null;
    }
    return { type: "mutation", envelope: validated.output };
  }

  private async persistMutation(envelope: EventEnvelope<Definitions[keyof Definitions]>): Promise<void> {
    await this.writeMutation(envelope);
  }

  private broadcastQueryResult(result: SyncResponse<Schemas>): void {
    if (!this.channel) {
      return;
    }

    if (result.mode !== "snapshot") {
      return;
    }

    for (const [tableName, rows] of Object.entries(result.data)) {
      for (const row of rows) {
        this.channel?.postMessage({ itemId: String(row.id), tableName });
      }
    }
  }

  destroy(): void {
    this.releaseLeadership?.();
    this.channel?.close();
    this.rescanChannel?.close();
    void this.closeDatabase();
  }

  async rescan(key: string): Promise<void> {
    await this.ready;
    const database = await this.dbPromise;
    const entry = (await database.get(STORE_NAMES.data, key)) as DataEntry | undefined;
    if (!entry || typeof entry.key !== "string") {
      return;
    }

    const [tableName] = entry.key.split("/", 1);
    const tableKey = tableName as Extract<keyof Schemas, string>;
    const table = this.store.data[tableKey];
    const schema = this.tableSchemas[tableKey];
    if (!schema) {
      return;
    }

    const parsed = v.parse(schema, entry.value);
    this.store.upsert(
      tableKey,
      parsed as TablesFromSchemas<Schemas>[Extract<keyof Schemas, string>][number],
    );
  }

  private async openDatabase(): Promise<IDBPDatabase<unknown>> {
    return openDB(this.id, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE_NAMES.data)) {
          database.createObjectStore(STORE_NAMES.data, { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains(STORE_NAMES.queryCache)) {
          database.createObjectStore(STORE_NAMES.queryCache, { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains(STORE_NAMES.mutationLog)) {
          database.createObjectStore(STORE_NAMES.mutationLog, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(STORE_NAMES.meta)) {
          database.createObjectStore(STORE_NAMES.meta, { keyPath: "key" });
        }
      },
    });
  }

  private async closeDatabase(): Promise<void> {
    const database = await this.dbPromise;
    database.close();
  }

  private async ensureMetaRow(): Promise<void> {
    const database = await this.dbPromise;
    const existing = await database.get(STORE_NAMES.meta, "instance");
    if (!existing) {
      await database.put(STORE_NAMES.meta, {
        key: "instance",
        value: {
          id: this.id,
          createdAt: Date.now(),
        },
      } satisfies MetaEntry);
    }
  }

  private async loadTables(): Promise<void> {
    const database = await this.dbPromise;
    const transaction = database.transaction([STORE_NAMES.data], "readonly");
    const store = transaction.objectStore(STORE_NAMES.data);
    const entries = (await store.getAll()) as DataEntry[];
    const data = createTables(this.tableSchemas);
    entries.forEach((entry) => {
      if (!entry || typeof entry.key !== "string") {
        return;
      }
      const [tableName] = entry.key.split("/", 1);
      const table = data[tableName as keyof TablesFromSchemas<Schemas>];
      const schema = this.tableSchemas[tableName as keyof Schemas];
      if (table && schema) {
        const parsed = v.parse(schema, entry.value);
        table.push(parsed as TablesFromSchemas<Schemas>[keyof TablesFromSchemas<Schemas>][number]);
      }
    });
    this.store.hydrate(data);
    await transaction.done;
  }

  private async writeMutation(envelope: EventEnvelope<Definitions[keyof Definitions]>): Promise<void> {
    const database = await this.dbPromise;
    await database.put(STORE_NAMES.mutationLog, envelope);
  }

  private async writeMutations(envelopes: Array<EventEnvelope<Definitions[keyof Definitions]>>): Promise<void> {
    if (envelopes.length === 0) {
      return;
    }
    if (this.leader) {
      for (const envelope of envelopes) {
        await this.writeMutation(envelope);
      }
    } else {
      for (const envelope of envelopes) {
        this.sendMutation(envelope);
      }
    }
  }

  private applyEvent(event: RawEvent<Definitions>): AppliedEvent<Schemas, Definitions> {
    const definition = this.eventDefinitions[event.name];
    if (!definition) {
      throw new Error(`Unknown event: ${event.name}`);
    }

    const payload = v.parse(definition.schema, event.payload);
    const envelope: EventEnvelope<Definitions[EventKey<Definitions>]> = {
      id: event.id,
      name: definition.name,
      payload: payload as EventPayload<Definitions[EventKey<Definitions>]>,
      timestamp: event.timestamp,
    };

    const handler = this.materializers[event.name];
    if (!handler) {
      throw new Error(`Missing materializer for event: ${event.name}`);
    }

    const context: MaterializerContext<Schemas, Definitions[EventKey<Definitions>]> = {
      db: this.store.data,
      event: envelope,
    };
    const actions = handler(payload as EventPayload<Definitions[EventKey<Definitions>]>, context);
    const rescanKeys = this.createRescanKeys(actions);
    this.store.mutate(actions);

    return { envelope, actions, rescanKeys };
  }

  private createRescanKeys(actions: Array<MaterializerAction<Schemas>>): Set<string> {
    const keys = new Set<string>();
    for (const action of actions) {
      const id = action.value.id;
      if (id === undefined) {
        continue;
      }
      keys.add(`${action.tableName}/${String(id)}`);
    }
    return keys;
  }

  private async persistActions(actions: Array<MaterializerAction<Schemas>>): Promise<void> {
    if (actions.length === 0) {
      return;
    }
    const database = await this.dbPromise;
    const transaction = database.transaction([STORE_NAMES.data], "readwrite");
    const store = transaction.objectStore(STORE_NAMES.data);
    for (const action of actions) {
      const id = action.value.id;
      if (id === undefined) {
        continue;
      }
      const key = `${action.tableName}/${String(id)}`;
      const nextValue = await this.resolveActionValue(store, key, action);
      if (!nextValue) {
        continue;
      }
      await store.put({
        key,
        value: this.cloneForStorage(nextValue),
      });
    }
    await transaction.done;
  }

  private async resolveActionValue(
    store: { get: (key: string) => Promise<DataEntry | undefined> },
    key: string,
    action: MaterializerAction<Schemas>,
  ): Promise<MaterializerAction<Schemas>["value"] | null> {
    if (action.type === "create") {
      return action.value;
    }
    const existing = await store.get(key);
    if (!existing || typeof existing.value !== "object" || existing.value === null) {
      return action.value;
    }
    return { ...(existing.value as Record<string, unknown>), ...action.value } as typeof action.value;
  }

  private cloneForStorage<T>(value: T): T {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {
        // Fall back to JSON serialization for non-cloneable values like proxies.
      }
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private toRawEvent(
    envelope: EventEnvelope<Definitions[keyof Definitions]>,
  ): RawEvent<Definitions> | null {
    const key = this.findDefinitionKey(envelope.name);
    if (!key) {
      return null;
    }
    return {
      id: envelope.id,
      name: key,
      payload: envelope.payload,
      timestamp: envelope.timestamp,
    };
  }

  private findDefinitionKey(name: string): EventKey<Definitions> | null {
    for (const [key, definition] of Object.entries(this.eventDefinitions)) {
      if (definition.name === name) {
        return key as EventKey<Definitions>;
      }
    }
    return null;
  }
}

type AppliedEvent<Schemas extends TableSchemas, Definitions extends EventDefinitions> = {
  envelope: EventEnvelope<Definitions[keyof Definitions]>;
  actions: Array<MaterializerAction<Schemas>>;
  rescanKeys: Set<string>;
};
