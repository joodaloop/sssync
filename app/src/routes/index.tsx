import { createSignal, For, Show } from "solid-js";
import { client } from "../client";

export default function Home() {
  const [posts, setPosts] = createSignal(client.tables.posts);
  const [title, setTitle] = createSignal("");
  const [body, setBody] = createSignal("");

  async function createPost(e: Event) {
    e.preventDefault();
    if (!title().trim()) return;

    await client.commit([
      {
        id: crypto.randomUUID(),
        name: "postCreated",
        payload: { id: crypto.randomUUID(), title: title(), body: body() },
        timestamp: Date.now(),
      },
    ]);

    setPosts([...client.tables.posts]);
    setTitle("");
    setBody("");
  }

  return (
    <main style={{ "font-family": "system-ui, sans-serif", padding: "2rem" }}>
      <h1>sssync test app</h1>

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

      <h2>Posts ({posts().length})</h2>
      <Show when={posts().length > 0} fallback={<p>No posts yet. Create one above.</p>}>
        <ul style={{ "list-style": "none", padding: 0 }}>
          <For each={posts()}>
            {(post) => (
              <li style={{ "margin-bottom": "1rem", "border-bottom": "1px solid #eee", "padding-bottom": "1rem" }}>
                <strong>{post.title}</strong>
                <p style={{ margin: "0.25rem 0", color: "#666" }}>{post.body}</p>
                <small style={{ color: "#999" }}>{post.id}</small>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </main>
  );
}
