import { type BaseIssue, type BaseSchema, type InferOutput } from 'valibot'

export type SchemaLike = BaseSchema<unknown, unknown, BaseIssue<unknown>>

export type TableSchemaLike = BaseSchema<unknown, { id: string }, BaseIssue<unknown>>

export type TableSchemas = Record<string, TableSchemaLike>

export type TablesFromSchemas<Schemas extends TableSchemas> = {
  [Key in keyof Schemas]: Array<InferOutput<Schemas[Key]>>
}

export type TableName<Schemas extends TableSchemas> = Extract<keyof Schemas, string>

type TableRow<Schemas extends TableSchemas, Name extends TableName<Schemas>> = InferOutput<
  Schemas[Name]
>

type BivariantCallback<T extends (...args: never[]) => unknown> = {
  bivarianceHack(...args: Parameters<T>): ReturnType<T>
}['bivarianceHack']

export type EventDefinition<Name extends string, Schema extends SchemaLike> = {
  name: Name
  schema: Schema
  dedupe?: BivariantCallback<(event: { name: Name; payload: InferOutput<Schema> }) => string> | undefined
}

export type EventDefinitions = Record<string, EventDefinition<string, SchemaLike>>

export type EventKey<Definitions extends EventDefinitions> = Extract<keyof Definitions, string>

export type EventPayload<Definition extends EventDefinition<string, SchemaLike>> = InferOutput<
  Definition['schema']
>

export type EventEnvelope<Definition extends EventDefinition<string, SchemaLike>> = {
  id: string
  name: Definition['name']
  payload: EventPayload<Definition>
  timestamp: number
}

export type RawEvent<Definitions extends EventDefinitions> = {
  id: string
  name: EventKey<Definitions>
  payload: unknown
  timestamp: number
}

export type MaterializerContext<
  Schemas extends TableSchemas,
  Definition extends EventDefinition<string, SchemaLike>
> = {
  db: TablesFromSchemas<Schemas>
  event: EventEnvelope<Definition>
}

export type MaterializerAction<Schemas extends TableSchemas> = {
  [Name in TableName<Schemas>]:
    | {
        type: 'create'
        tableName: Name
        value: TableRow<Schemas, Name>
      }
    | {
        type: 'update'
        tableName: Name
        value: Partial<TableRow<Schemas, Name>> & { id: string }
      }
}[TableName<Schemas>]

export type InMemoryStore<Schemas extends TableSchemas> = {
  data: TablesFromSchemas<Schemas>
  mutate: (actions: Array<MaterializerAction<Schemas>>) => void
  hydrate: (data: TablesFromSchemas<Schemas>) => void
  upsert: <Name extends TableName<Schemas>>(
    tableName: Name,
    row: TablesFromSchemas<Schemas>[Name][number]
  ) => void
}

export type Materializer<
  Schemas extends TableSchemas,
  Definition extends EventDefinition<string, SchemaLike>
> = (
  payload: EventPayload<Definition>,
  ctx: MaterializerContext<Schemas, Definition>
) => Array<MaterializerAction<Schemas>>

export type MaterializerMap<
  Schemas extends TableSchemas,
  Definitions extends EventDefinitions
> = { [Key in keyof Definitions]: Materializer<Schemas, Definitions[Key]> }

export type SyncResponse<Schemas extends TableSchemas> =
  | {
      mode: 'snapshot'
      data: TablesFromSchemas<Schemas>
    }
  | {
      mode: 'actions'
      data: Array<MaterializerAction<Schemas>>
    }

export type QueryKey = readonly [string, ...Array<string | number>]

export type QueryResult<Value> = {
  value: Value
  updatedAt: number
}

export const createTables = <Schemas extends TableSchemas>(tableSchemas: Schemas): TablesFromSchemas<Schemas> => {
  const entries = Object.keys(tableSchemas).map((key) => [key, []]);
  return Object.fromEntries(entries) as TablesFromSchemas<Schemas>;
};
