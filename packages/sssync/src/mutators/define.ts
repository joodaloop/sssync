import { Result } from 'better-result'

import type { Failure } from '../errors'
import { safeValidate } from '../json-validator'
import type { IdInputOf, IdOf } from '../schema/infer'
import type { ClientDatabaseSchema } from '../schema/table-schema'
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
>(
  schema: S,
  definitions: Definitions,
  envelope: ParsedMutatorEnvelope<Definitions>,
): Promise<Result<readonly Mutation<S>[], Failure>> {
  const definition = (definitions as Record<string, AnyMutatorDefinition<S>>)[envelope.name]

  if (!definition) {
    return Result.err({ type: 'mutator', offending: envelope.name })
  }

  const mutations: Mutation<S>[] = []
  const tx: MutatorTx<S> = {
    mutate: createCollectingDb(schema, mutations),
  }

  return Result.tryPromise({
    try: async (): Promise<readonly Mutation<S>[]> => {
      await definition.effect({ tx, args: envelope.args })
      return mutations
    },
    catch: (error): Failure => ({ type: 'mutator', offending: error }),
  })
}

function parseEnvelope<const Definitions extends Record<string, AnyMutatorDefinition>>(
  definitions: Definitions,
  input: unknown,
): Result<ParsedMutatorEnvelope<Definitions>, Failure> {
  if (input === null || typeof input !== 'object') {
    return Result.err({ type: 'validation', offending: input })
  }

  const envelope = input as { name?: unknown; args?: unknown }

  if (typeof envelope.name !== 'string') {
    return Result.err({ type: 'validation', offending: input })
  }

  const definition = (definitions as Record<string, AnyMutatorDefinition>)[envelope.name]

  if (!definition) {
    return Result.err({ type: 'mutator', offending: envelope.name })
  }

  const result = safeValidate(definition.args, envelope.args)

  if (Result.isError(result)) {
    return Result.err({ type: 'validation', offending: envelope.args })
  }

  return Result.ok({
    name: envelope.name,
    args: result.value,
  } as ParsedMutatorEnvelope<Definitions>)
}

function createCollectingDb<const S extends ClientDatabaseSchema>(schema: S, mutations: Mutation<S>[]): MutationDb<S> {
  const collecting: Record<string, unknown> = {}

  for (const [tableName, table] of Object.entries(schema.tables)) {
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
  }

  return collecting as MutationDb<S>
}
