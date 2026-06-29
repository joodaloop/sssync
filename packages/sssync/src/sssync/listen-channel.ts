import { safeValidate, type Validator } from '../json-validator'

export type ChannelHandler<S extends Validator<unknown>> = (
  message: S extends Validator<infer Output> ? Output : never,
) => void

export interface ChannelListener<S extends Validator<unknown>> {
  handle(handler: ChannelHandler<S>): () => void
  close(): void
}

export function listenChannel<S extends Validator<unknown>>(
  sssyncId: string,
  name: string,
  schema: S,
): ChannelListener<S> {
  const channel = new BroadcastChannel(`sssync:${sssyncId}:${name}`)

  return {
    handle(handler) {
      const listener = (event: MessageEvent<unknown>) => {
        const parsed = safeValidate(schema, event.data)
        if (!parsed.success) {
          console.warn(`Invalid ${name} channel message:`, parsed.issues)
          return
        }

        handler(parsed.output as S extends Validator<infer Output> ? Output : never)
      }

      channel.addEventListener('message', listener)
      return () => {
        channel.removeEventListener('message', listener)
      }
    },
    close() {
      channel.close()
    },
  }
}
