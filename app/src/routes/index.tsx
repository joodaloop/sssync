import { createResource, For, Show, createSignal } from "solid-js";
import type { User, Post } from "../server/data";

async function fetchUsers(): Promise<User[]> {
  const res = await fetch("/api/users");
  return res.json();
}

async function fetchUserPosts(id: number): Promise<Post[]> {
  const res = await fetch(`/api/users/${id}/posts`);
  return res.json();
}

export default function Home() {
  const [users] = createResource(fetchUsers);
  const [selectedUserId, setSelectedUserId] = createSignal<number | null>(null);
  const [posts] = createResource(selectedUserId, (id) => fetchUserPosts(id));

  return (
    <main style={{ "font-family": "system-ui, sans-serif", padding: "2rem" }}>
      <h1>sssync test app</h1>

      <h2>Users</h2>
      <Show when={!users.loading} fallback={<p>Loading users...</p>}>
        <ul>
          <For each={users()}>
            {(user) => (
              <li>
                <button
                  onClick={() => setSelectedUserId(user.id)}
                  style={{
                    "font-weight": selectedUserId() === user.id ? "bold" : "normal",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    "text-decoration": "underline",
                    padding: 0,
                    font: "inherit",
                    color: "blue",
                  }}
                >
                  {user.name}
                </button>{" "}
                — {user.email}
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={selectedUserId()}>
        <h2>Posts</h2>
        <Show when={!posts.loading} fallback={<p>Loading posts...</p>}>
          <Show when={posts()?.length} fallback={<p>No posts found.</p>}>
            <ul>
              <For each={posts()}>
                {(post) => (
                  <li>
                    <strong>{post.title}</strong>
                    <p>{post.body}</p>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>
    </main>
  );
}
