import { For, Show, createSignal, onCleanup } from "solid-js";
import { client, type Post } from "../client";

export default function Home() {
  const posts = client.db.liveQuery<Post>((q) =>
    q
      .from({ post: client.collections.posts })
      .select(({ post }) => {
        const row = post as unknown as Post;
        return {
          id: row.id,
          title: row.title,
          body: row.body,
          createdAt: row.createdAt,
        };
      })
      .orderBy(({ post }) => (post as unknown as Post).title, "asc"),
  );
  onCleanup(() => posts.dispose());

  const [title, setTitle] = createSignal("");
  const [body, setBody] = createSignal("");

  function createPost(e: Event) {
    e.preventDefault();
    if (!title().trim()) {
      return;
    }

    client.createPost({ title: title(), body: body() });

    setTitle("");
    setBody("");
  }

  return (
    <main style={{ "font-family": "system-ui, sans-serif", padding: "2rem", "max-width": "52rem" }}>
      <h1>solid-ivm demo</h1>
      <p style={{ color: "#666", "margin-top": "0.25rem" }}>
        TanStack Collections are the source of truth, and <code>liveQuery()</code> projects ordered
        rows into a granular Solid store.
      </p>

      <h2>Create Post</h2>
      <form onSubmit={createPost} style={{ "margin-bottom": "2rem" }}>
        <div style={{ "margin-bottom": "0.5rem" }}>
          <input
            type="text"
            placeholder="Title"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            style={{ padding: "0.5rem", width: "300px" }}
          />
        </div>
        <div style={{ "margin-bottom": "0.5rem" }}>
          <textarea
            placeholder="Body"
            value={body()}
            onInput={(e) => setBody(e.currentTarget.value)}
            style={{ padding: "0.5rem", width: "300px", height: "80px" }}
          />
        </div>
        <button type="submit" style={{ padding: "0.5rem 1rem" }}>
          Create Post
        </button>
      </form>

      <div style={{ display: "flex", gap: "0.75rem", "margin-bottom": "1.5rem", "flex-wrap": "wrap" }}>
        <button type="button" onClick={() => client.runBatchDemo()} style={{ padding: "0.5rem 1rem" }}>
          Run apply() demo
        </button>
        <button
          type="button"
          onClick={() => client.replaceWithFixture()}
          style={{ padding: "0.5rem 1rem" }}
        >
          Run replace() demo
        </button>
      </div>

      <h2>Posts ({posts.data.order.length})</h2>
      <Show when={posts.data.order.length > 0} fallback={<p>No posts yet. Create one above.</p>}>
        <ul style={{ "list-style": "none", padding: 0 }}>
          <For each={posts.rows()}>
            {(post) => (
              <li
                style={{
                  "margin-bottom": "1rem",
                  "border-bottom": "1px solid #eee",
                  "padding-bottom": "1rem",
                }}
              >
                <strong>{post.title}</strong>
                <p style={{ margin: "0.25rem 0", color: "#666" }}>{post.body}</p>
                <div style={{ display: "flex", gap: "0.5rem", "margin-top": "0.5rem", "flex-wrap": "wrap" }}>
                  <button
                    type="button"
                    onClick={() => client.updatePost(post.id, { title: `${post.title} (edited)` })}
                    style={{ padding: "0.35rem 0.75rem" }}
                  >
                    Update title
                  </button>
                  <button
                    type="button"
                    onClick={() => client.deletePost(post.id)}
                    style={{ padding: "0.35rem 0.75rem" }}
                  >
                    Delete
                  </button>
                </div>
                <small style={{ color: "#999", display: "block", "margin-top": "0.5rem" }}>
                  {post.id}
                </small>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </main>
  );
}
