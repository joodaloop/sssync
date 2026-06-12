import * as v from 'valibot'

export type ChannelHandler<S extends v.GenericSchema> = (
  message: v.InferOutput<S>,
) => void

export interface ChannelListener<S extends v.GenericSchema> {
  handle(handler: ChannelHandler<S>): () => void
  close(): void
}

export function listenChannel<S extends v.GenericSchema>(
  sssyncId: string,
  name: string,
  schema: S,
): ChannelListener<S> {
  const channel = new BroadcastChannel(`sssync:${sssyncId}:${name}`)

  return {
    handle(handler) {
      const listener = (event: MessageEvent<unknown>) => {
        const parsed = v.safeParse(schema, event.data)
        if (!parsed.success) {
          console.warn(`Invalid ${name} channel message:`, parsed.issues)
          return
        }

        handler(parsed.output)
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
