import type * as v from "valibot";

export type EventName = `v${number}_${string}`;

export type EventSchema = v.GenericSchema;

export type EventMap = Record<string, EventSchema>;

export type EventArgs<S extends EventSchema> = v.InferInput<S>;

export type EventPayload<S extends EventSchema> = v.InferOutput<S>;

type NoTransformEventSchema<S extends EventSchema> =
  S extends v.GenericSchema<infer Input, infer Output>
    ? [Input] extends [Output]
      ? [Output] extends [Input]
        ? S
        : never
      : never
    : never;

export type NoTransformEventMap<Events extends EventMap> = {
  [K in keyof Events]: NoTransformEventSchema<Events[K]>;
};
