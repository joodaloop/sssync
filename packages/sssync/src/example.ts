import * as v from "valibot";
import { Events, SSSync, type MaterializerMap } from "./index";

const events = {
  pageCreated: Events.define({
    name: "pageCreated",
    schema: v.object({
      id: v.string(),
      title: v.string(),
    }),
  }),
  pageRenamed: Events.define({
    name: "pageRenamed",
    schema: v.object({
      id: v.string(),
      title: v.string(),
    }),
  }),
};

const tableSchemas = {
  pages: v.object({
    id: v.string(),
    title: v.string(),
  }),
};

const materializers: MaterializerMap<typeof tableSchemas, typeof events> = {
  pageCreated: (payload) => [
    {
      type: "create",
      tableName: "pages",
      value: { id: payload.id, title: payload.title },
    },
  ],
  pageRenamed: (payload) => [
    {
      type: "update",
      tableName: "pages",
      value: { id: payload.id, title: payload.title },
    },
  ],
};

export const example = new SSSync("example-client", events, materializers, tableSchemas);
