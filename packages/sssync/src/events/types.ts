import type * as v from "valibot";

export type EventName = `v${number}_${string}`;

export type EventMap = Record<EventName, v.GenericSchema>;

export type EventArgs<S extends v.GenericSchema> = v.InferInput<S>;
