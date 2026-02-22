import { describe, expect, it } from "bun:test";
import {
  createSolidIvmCollections,
  createSolidIvmDatabase,
  type CollectionMap,
} from "../src/index";

type Post = {
  id: string;
  title: string;
  body: string;
  done: boolean;
};

function createTestDatabase(initialData: Array<Post> = []) {
  const collections = createSolidIvmCollections({
    posts: {
      getKey: (post: Post) => post.id,
      initialData,
    },
  });

  const db = createSolidIvmDatabase({
    collections: collections as unknown as CollectionMap,
  });

  return {
    db,
    collections,
  };
}

describe("solid-ivm", () => {
  it("applies insert, upsert, update, delete, and replace to collections", () => {
    const { db, collections } = createTestDatabase();

    db.insert("posts", { id: "1", title: "one", body: "", done: false });
    db.upsert("posts", { id: "1", title: "one-upsert", body: "", done: true });
    db.insert("posts", { id: "2", title: "two", body: "", done: false });
    db.update("posts", "2", { title: "two-updated" });
    db.delete("posts", "1");

    expect(Array.from(collections.posts.values()).map((post) => post.id)).toEqual(["2"]);
    expect(Array.from(collections.posts.values())[0]?.title).toBe("two-updated");

    db.replace({
      posts: [
        { id: "3", title: "three", body: "", done: false },
        { id: "4", title: "four", body: "", done: true },
      ],
    });

    expect(Array.from(collections.posts.values()).map((post) => post.id)).toEqual([
      "3",
      "4",
    ]);
  });

  it("applies batched actions in order", () => {
    const { db, collections } = createTestDatabase();

    db.apply([
      {
        type: "insert",
        collection: "posts",
        value: { id: "1", title: "one", body: "", done: false },
      },
      {
        type: "insert",
        collection: "posts",
        value: { id: "2", title: "two", body: "", done: false },
      },
      {
        type: "update",
        collection: "posts",
        key: "2",
        value: { title: "two-updated", done: true },
      },
      {
        type: "delete",
        collection: "posts",
        key: "1",
      },
    ]);

    const rows = Array.from(collections.posts.values());
    expect(rows.map((post) => post.id)).toEqual(["2"]);
    expect(rows[0]?.title).toBe("two-updated");
    expect(rows[0]?.done).toBe(true);
  });
});
