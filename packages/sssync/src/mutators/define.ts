import type { IdInputOf, IdOf } from '../schema/infer'
import type { ClientDatabaseSchema } from '../schema/table-schema'
import type { StandardSchemaV1 } from '../types'
import type {
  AnyMutatorDefinition,
  DefineMutator,
  InsertOf,
  Mutation,
  MutationDb,
  MutatorArgs,
  Mutators,
  MutatorTx,
  UpdateOf,
} from './types'

type ParsedMutatorEnvelope<Definitions extends Record<string, AnyMutatorDefinition>> = {
  [Name in keyof Definitions & string]: {
    name: Name
    args: MutatorArgs<Definitions[Name]['args']>
  }
}[keyof Definitions & string]

export function defineMutators<
  const S extends ClientDatabaseSchema,
  const Definitions extends {
    [K in keyof Definitions]: AnyMutatorDefinition<S>
  },
>(schema: S, build: (define: DefineMutator<S>) => Definitions): Mutators<S, Definitions> {
  const definitions = build((args, effect) => ({ args, effect }))

  return {
    parse: input => parseEnvelope(definitions, input),
    apply: envelope => applyEnvelope(schema, definitions, envelope),
  }
}

async function applyEnvelope<
  const S extends ClientDatabaseSchema,
  const Definitions extends Record<string, AnyMutatorDefinition<S>>,
>(schema: S, definitions: Definitions, envelope: ParsedMutatorEnvelope<Definitions>): Promise<readonly Mutation<S>[]> {
  const definition = (definitions as Record<string, AnyMutatorDefinition<S>>)[envelope.name]

  if (!definition) {
    throw new Error(`Unknown mutation "${envelope.name}"`)
  }

  const mutations: Mutation<S>[] = []
  const tx: MutatorTx<S> = {
    mutate: createCollectingDb(schema, mutations),
  }

  await definition.effect({ tx, args: envelope.args })
  return mutations
}

function parseEnvelope<const Definitions extends Record<string, AnyMutatorDefinition>>(
  definitions: Definitions,
  input: unknown,
): ParsedMutatorEnvelope<Definitions> {
  if (input === null || typeof input !== 'object') {
    throw new Error('Mutation envelope must be an object')
  }

  const envelope = input as { name?: unknown; args?: unknown }

  if (typeof envelope.name !== 'string') {
    throw new Error('Mutation envelope name must be a string')
  }

  const definition = (definitions as Record<string, AnyMutatorDefinition>)[envelope.name]

  if (!definition) {
    throw new Error(`Unknown mutation "${envelope.name}"`)
  }

  const result = definition.args['~standard'].validate(envelope.args)

  if (result instanceof Promise) {
    throw new Error('Async mutator argument schemas are not supported')
  }

  if (result.issues) {
    throw new Error(result.issues.map((issue: StandardSchemaV1.Issue) => issue.message).join('; '))
  }

  return {
    name: envelope.name,
    args: result.value,
  } as ParsedMutatorEnvelope<Definitions>
}

function createCollectingDb<const S extends ClientDatabaseSchema>(schema: S, mutations: Mutation<S>[]): MutationDb<S> {
  const collecting: Record<string, unknown> = {}

  Object.entries(schema.tables).forEach(([tableName, table]) => {
    const idOf = (id: unknown) => (table.primaryKey.length === 1 ? { [table.primaryKey[0]]: id } : id)

    collecting[tableName] = {
      insert: (id: IdInputOf<typeof table>, data: InsertOf<typeof table>) => {
        const mutation = {
          type: 'INSERT' as const,
          table: tableName,
          data: {
            ...(idOf(id) as IdOf<typeof table>),
            ...data,
          },
        } as Mutation<S>
        mutations.push(mutation)
        return mutation
      },
      update: (id: IdInputOf<typeof table>, changes: UpdateOf<typeof table>) => {
        const mutation = {
          type: 'UPDATE' as const,
          table: tableName,
          id: idOf(id) as IdOf<typeof table>,
          changes: { ...changes },
        } as Mutation<S>
        mutations.push(mutation)
        return mutation
      },
      remove: (id: IdInputOf<typeof table>) => {
        const mutation = {
          type: 'DELETE' as const,
          table: tableName,
          id: idOf(id) as IdOf<typeof table>,
        } as Mutation<S>
        mutations.push(mutation)
        return mutation
      },
    }
  })

  return collecting as MutationDb<S>
}
