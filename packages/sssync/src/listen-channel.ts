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

  // Unique per-instance id so we can tag outgoing messages and ignore the ones
  // that originate from this same instance.
  const instanceId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  interface Envelope {
    senderId: string
    message: unknown
  }

  const isEnvelope = (data: unknown): data is Envelope =>
    typeof data === 'object' && data !== null && 'senderId' in data && 'message' in data

  return {
    handle(handler) {
      const listener = (event: MessageEvent<unknown>) => {
        if (!isEnvelope(event.data)) {
          console.warn(`Invalid ${name} channel message: missing envelope`)
          return
        }

        // Drop messages this instance posted itself.
        if (event.data.senderId === instanceId) {
          return
        }

        const parsed = safeValidate(schema, event.data.message)
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
      channel.postMessage({ senderId: instanceId, message } satisfies Envelope)
    },
    close() {
      channel.close()
    },
  }
}
