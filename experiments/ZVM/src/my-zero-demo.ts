import { createSchema } from "../packages/zero-schema/src/builder/schema-builder.ts";
import { number, string, table } from "../packages/zero-schema/src/builder/table-builder.ts";
import { MyZero } from "./my-zero/my-zero.ts";

const users = table("users")
  .columns({
    id: number(),
    name: string(),
  })
  .primaryKey("id");

const issues = table("issues")
  .columns({
    id: number(),
    title: string(),
    ownerId: number(),
  })
  .primaryKey("id");

const schema = createSchema({
  tables: [users, issues],
  relationships: [],
});

const zero = new MyZero(schema);

zero.seed("users", [{ id: 1, name: "Ada" }]);

const unsubscribe = zero.subscribeChanges(zero.query().users.limit(3), (change) => {
  console.log("change:", JSON.stringify(change));
});

zero.ingest("issues", { type: "add", row: { id: 1, title: "Ignored", ownerId: 1 } });
zero.ingest("users", { type: "add", row: { id: 2, name: "Grace" } });
zero.ingest("users", {
  type: "edit",
  oldRow: { id: 2 },
  row: { id: 2, name: "Grace Hopper" },
});
zero.ingest("users", { type: "remove", row: { id: 1, name: "Ada" } });

unsubscribe();

zero.ingest("users", { type: "add", row: { id: 3, name: "No listener now" } });

console.log("done");
