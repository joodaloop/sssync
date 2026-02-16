import type { EventDefinition, SchemaLike } from '../types'

export const Events = {
  define: <Name extends string, Schema extends SchemaLike>(options: {
    name: Name
    schema: Schema
    dedupe?: (event: { name: Name; payload: import('valibot').InferOutput<Schema> }) => string
  }): EventDefinition<Name, Schema> => ({
    name: options.name,
    schema: options.schema,
    dedupe: options.dedupe
  })
}
