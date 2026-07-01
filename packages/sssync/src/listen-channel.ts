import { safeValidate } from './json-validator'
import type { Validator } from './json-validator'

export type ChannelHandler<S extends Validator<unknown>> = (
  message: S extends Validator<infer Output> ? Output : never,
) => void

export interface ChannelListener<S extends Validator<unknown>> {
  handle(handler: ChannelHandler<S>): () => void
  post(message: S extends Validator<infer Output> ? Output : never): void
  close(): void
}

export function listenChannel<S extends Validator<unknown>>(
  dbName: string,
  name: string,
  schema: S,
): ChannelListener<S> {
  // No BroadcastChannel outside the browser (e.g. the server): return a channel
  // whose methods are no-ops so callers don't have to guard the environment.
  if (typeof BroadcastChannel === 'undefined') {
    return { handle: () => () => {}, post: () => {}, close: () => {} }
  }

  const channel = new BroadcastChannel(`sssync:${dbName}:${name}`)

  return {
    handle(handler) {
      const listener = (event: MessageEvent<unknown>) => {
        const parsed = safeValidate(schema, event.data)
        if (!parsed.ok) {
          console.warn(`Invalid ${name} channel message:`, parsed.error)
          return
        }

        handler(parsed.value as S extends Validator<infer Output> ? Output : never)
      }

      channel.addEventListener('message', listener)
      return () => {
        channel.removeEventListener('message', listener)
      }
    },
    post(message) {
      channel.postMessage(message)
    },
    close() {
      channel.close()
    },
  }
}
