import * as v from "valibot";
import { Events, SSSync, createSolidStore, createTables, type MaterializerMap } from "sssync";

const events = {
  postCreated: Events.define({
    name: "postCreated",
    schema: v.object({
      id: v.string(),
      title: v.string(),
      body: v.string(),
    }),
  }),
};

const tableSchemas = {
  posts: v.object({
    id: v.string(),
    title: v.string(),
    body: v.string(),
  }),
};

const materializers: MaterializerMap<typeof tableSchemas, typeof events> = {
  postCreated: (payload) => [
    {
      type: "create",
      tableName: "posts",
      value: { id: payload.id, title: payload.title, body: payload.body },
    },
  ],
};

export const client = new SSSync(
  "test-app",
  events,
  materializers,
  tableSchemas,
  createSolidStore(createTables(tableSchemas)),
);
