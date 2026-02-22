import { createSolidIvmCollections, createSolidIvmDatabase } from "@sssync/solid-ivm";
import type { Collection } from "@tanstack/db";

export type Post = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
};

const collections = createSolidIvmCollections({
  posts: {
    getKey: (post: object) => (post as { id: string }).id,
    initialData: [
      {
        id: "p-1",
        title: "First Post",
        body: "This row is seeded in a TanStack Collection.",
        createdAt: Date.now() - 2000,
      },
      {
        id: "p-2",
        title: "Second Post",
        body: "Query results are projected into a Solid store.",
        createdAt: Date.now() - 1000,
      },
    ] as Array<object>,
  },
});

const db = createSolidIvmDatabase({
  collections: collections as unknown as Record<string, Collection<object, string | number>>,
});

function createPost(value: Pick<Post, "title" | "body">): Post {
  const post: Post = {
    id: crypto.randomUUID(),
    title: value.title,
    body: value.body,
    createdAt: Date.now(),
  };
  db.insert("posts", post);
  return post;
}

function updatePost(id: string, value: Partial<Omit<Post, "id">>): void {
  db.update("posts", id, value);
}

function deletePost(id: string): void {
  db.delete("posts", id);
}

function runBatchDemo(): void {
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  db.apply([
    {
      type: "insert",
      collection: "posts",
      value: {
        id: firstId,
        title: "Batch Alpha",
        body: "Inserted through db.apply",
        createdAt: Date.now(),
      },
    },
    {
      type: "insert",
      collection: "posts",
      value: {
        id: secondId,
        title: "Batch Beta",
        body: "Also inserted through db.apply",
        createdAt: Date.now() + 1,
      },
    },
    {
      type: "update",
      collection: "posts",
      key: firstId,
      value: { title: "Batch Alpha (updated)" },
    },
    {
      type: "delete",
      collection: "posts",
      key: secondId,
    },
  ]);
}

function replaceWithFixture(): void {
  db.replace({
    posts: [
      {
        id: "r-1",
        title: "Replace Snapshot",
        body: "`replace()` hydrates and diffs collection state.",
        createdAt: Date.now(),
      },
      {
        id: "r-2",
        title: "Works With Ordering",
        body: "Rows still flow through ordered liveQuery output.",
        createdAt: Date.now() + 1,
      },
    ],
  });
}

export const client = {
  collections,
  db,
  createPost,
  updatePost,
  deletePost,
  runBatchDemo,
  replaceWithFixture,
};
