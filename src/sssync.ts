import { type IDBPDatabase, openDB } from "idb";
import * as v from "valibot";
import type {
  EventDefinitions,
  EventEnvelope,
  EventKey,
  EventPayload,
  MaterializerAction,
  MaterializerContext,
  MaterializerMap,
  RawEvent,
  SyncResponse,
  TableSchemas,
  TablesFromSchemas,
} from "./types";
import { QueryCache } from "./cache/query-cache";

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
  readonly tables: TablesFromSchemas<Schemas>;
  private readonly eventDefinitions: Definitions;
  private readonly materializers: MaterializerMap<Schemas, Definitions>;
  private readonly events: Array<EventEnvelope<Definitions[keyof Definitions]>>;
  private readonly queryCache: QueryCache<unknown>;
  private readonly dbPromise: Promise<IDBPDatabase<unknown>>;
  private readonly tableSchemas: Schemas;
  readonly ready: Promise<void>;
  private leader = false;
  private releaseLeadership?: () => void;
  private readonly channel: BroadcastChannel | undefined;
  private readonly syncResponseSchema: v.BaseSchema<unknown, SyncResponse<Schemas>, unknown>;

  constructor(
    id: string,
    events: Definitions,
    materializers: MaterializerMap<Schemas, Definitions>,
    tableSchemas: Schemas,
  ) {
    this.id = id;
    this.eventDefinitions = events;
    this.materializers = materializers;
    this.tableSchemas = tableSchemas;
    this.tables = this.createTables(tableSchemas);
    this.events = [];
    this.queryCache = new QueryCache();
    this.dbPromise = this.openDatabase();
    this.ready = this.initialize();
    this.channel = this.createChannel();
    this.syncResponseSchema = this.createSyncResponseSchema(tableSchemas);
    this.attachChannelListeners();
    this.startLeaderElection();
  }

  get isLeader(): boolean {
    return this.leader;
  }

  async commit(events: RawEvent<Definitions>[]): Promise<EventEnvelope<Definitions[keyof Definitions]>[]> {
    await this.ready;
    const envelopes = events.map((event) => this.applyEvent(event));
    this.events.push(...envelopes);
    await this.writeMutations(envelopes);
    await this.persistTables();
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

  private createTables(tableSchemas: Schemas): TablesFromSchemas<Schemas> {
    const entries = Object.keys(tableSchemas).map((key) => [key, []]);
    return Object.fromEntries(entries) as TablesFromSchemas<Schemas>;
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

  private async initialize(): Promise<void> {
    await this.ensureMetaRow();
    await this.loadTables();
  }

  private createChannel(): BroadcastChannel | undefined {
    if (typeof BroadcastChannel === "undefined") {
      return undefined;
    }
    return new BroadcastChannel(`sssync:${this.id}`);
  }

  private attachChannelListeners(): void {
    if (!this.channel) {
      return;
    }

    this.channel.addEventListener("message", (event) => {
      const data = event.data as
        | { type?: string; envelope?: EventEnvelope<Definitions[keyof Definitions]> }
        | undefined;
      if (!data || data.type !== "mutation" || !data.envelope) {
        return;
      }
      if (!this.leader) {
        return;
      }
      void this.persistMutation(data.envelope);
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

  private async persistMutation(envelope: EventEnvelope<Definitions[keyof Definitions]>): Promise<void> {
    await this.ready;
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
    entries.forEach((entry) => {
      if (!entry || typeof entry.key !== "string") {
        return;
      }
      const [tableName] = entry.key.split("/", 1);
      const table = this.tables[tableName as keyof TablesFromSchemas<Schemas>];
      const schema = this.tableSchemas[tableName as keyof Schemas];
      if (table && schema) {
        const parsed = v.parse(schema, entry.value);
        table.push(parsed as TablesFromSchemas<Schemas>[keyof TablesFromSchemas<Schemas>][number]);
      }
    });
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

  private applyEvent(event: RawEvent<Definitions>): EventEnvelope<Definitions[EventKey<Definitions>]> {
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
      db: this.tables,
      event: envelope,
    };
    const actions = handler(payload as EventPayload<Definitions[EventKey<Definitions>]>, context);
    this.applyActions(actions);

    return envelope;
  }

  private applyActions(actions: Array<MaterializerAction<Schemas>>): void {
    for (const action of actions) {
      const table = this.tables[action.tableName];
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
  }

  private async persistTables(): Promise<void> {
    const database = await this.dbPromise;
    const transaction = database.transaction([STORE_NAMES.data], "readwrite");
    const store = transaction.objectStore(STORE_NAMES.data);
    await store.clear();
    for (const [tableName, rows] of Object.entries(this.tables)) {
      for (const row of rows as Array<{ id?: string | number }>) {
        if (row?.id === undefined) {
          continue;
        }
        await store.put({ key: `${tableName}/${String(row.id)}`, value: row });
      }
    }
    await transaction.done;
  }
}
