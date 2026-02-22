import { For, Show, createEffect, createSignal } from "solid-js";
import { client, type Post } from "../client";

export default function Home() {
  const posts = client.db.liveQuery((q) =>
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

  let batchNumber = 0;
  let previousById = new Map<string, Post>();
  let previousOrder: Array<string> = [];
  const rowRenderCounts = new Map<string, number>();

  const [diagnostics, setDiagnostics] = createSignal({
    batch: 0,
    totalRows: 0,
    added: 0,
    removed: 0,
    changed: 0,
    moved: 0,
    stableReferences: 0,
  });

  function logRowsSnapshot(label: string): void {
    const rows = posts();
    console.table(
      rows.map((row, index) => ({
        index,
        id: row.id,
        title: row.title,
      })),
    );
    console.log(`[liveQuery][snapshot:${label}]`, rows.map((row) => row.id));
  }

  function runApplyDemo(): void {
    console.groupCollapsed("[demo] apply() mutation batch");
    console.log("insert(first), insert(second), update(first title), delete(second)");
    logRowsSnapshot("before apply");
    client.runBatchDemo();
    queueMicrotask(() => {
      logRowsSnapshot("after apply");
      console.groupEnd();
    });
  }

  function runReplaceDemo(): void {
    console.groupCollapsed("[demo] replace() snapshot hydration");
    console.log("replace posts table with fixture rows r-1 and r-2");
    logRowsSnapshot("before replace");
    client.replaceWithFixture();
    queueMicrotask(() => {
      logRowsSnapshot("after replace");
      console.groupEnd();
    });
  }

  createEffect(() => {
    const rows = posts();
    const nextById = new Map(rows.map((row) => [row.id, row] as const));
    const nextOrder = rows.map((row) => row.id);

    const added = nextOrder.filter((id) => !previousById.has(id));
    const removed = previousOrder.filter((id) => !nextById.has(id));
    const changed = nextOrder.filter((id) => {
      const previous = previousById.get(id);
      const next = nextById.get(id);
      if (!previous || !next) {
        return false;
      }
      return previous.title !== next.title || previous.body !== next.body;
    });
    const moved = nextOrder.filter((id, index) => {
      const previousIndex = previousOrder.indexOf(id);
      return previousIndex !== -1 && previousIndex !== index;
    });
    const stableReferences = nextOrder.filter((id) => {
      const previous = previousById.get(id);
      const next = nextById.get(id);
      return previous !== undefined && previous === next;
    }).length;

    batchNumber += 1;
    console.groupCollapsed(
      `[liveQuery][batch ${batchNumber}] rows=${rows.length} +${added.length} -${removed.length} Δ${changed.length} ⇄${moved.length}`,
    );
    console.log("order", nextOrder);
    console.log("added", added);
    console.log("removed", removed);
    console.log("changed", changed);
    console.log("moved", moved);
    console.log(`stable row object references: ${stableReferences}/${rows.length}`);
    console.groupEnd();

    setDiagnostics({
      batch: batchNumber,
      totalRows: rows.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      moved: moved.length,
      stableReferences,
    });

    previousById = nextById;
    previousOrder = nextOrder;
  });

  createEffect(() => {
    console.log(`[liveQuery][status] ${posts.status}`);
    console.log("[liveQuery][state-keys]", Array.from(posts.state.keys()));
  });

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
      <p style={{ color: "#666", "margin-top": "0.25rem", "font-size": "0.95rem" }}>
        Granularity proof: open console and update one row. The batch log should show
        <code>Δ1</code>, and stable references should stay high (for example, <code>9/10</code>),
        which indicates unchanged rows were not recomputed.
      </p>

      <section
        style={{
          background: "#f7f7f7",
          border: "1px solid #eaeaea",
          padding: "0.75rem",
          "border-radius": "0.5rem",
          "margin-top": "1rem",
          "margin-bottom": "1.5rem",
          "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
          "font-size": "0.85rem",
        }}
      >
        <div>batch: {diagnostics().batch}</div>
        <div>
          rows: {diagnostics().totalRows} | +{diagnostics().added} -{diagnostics().removed} Δ
          {diagnostics().changed} ⇄{diagnostics().moved}
        </div>
        <div>
          stable row references: {diagnostics().stableReferences}/{diagnostics().totalRows}
        </div>
      </section>

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
        <button type="button" onClick={runApplyDemo} style={{ padding: "0.5rem 1rem" }}>
          Run apply() demo
        </button>
        <button
          type="button"
          onClick={runReplaceDemo}
          style={{ padding: "0.5rem 1rem" }}
        >
          Run replace() demo
        </button>
      </div>
      <p style={{ color: "#666", "font-size": "0.9rem", "margin-top": "-0.75rem", "margin-bottom": "1.5rem" }}>
        <code>apply()</code> runs a mutation list in order (insert/update/delete). <code>replace()</code>
        treats the payload as the full table snapshot: upsert listed rows, delete missing rows.
      </p>

      <h2>Posts ({posts().length})</h2>
      <Show when={posts().length > 0} fallback={<p>No posts yet. Create one above.</p>}>
        <ul style={{ "list-style": "none", padding: 0 }}>
          <For each={posts()}>
            {(post) => {
              createEffect(() => {
                const nextCount = (rowRenderCounts.get(post.id) ?? 0) + 1;
                rowRenderCounts.set(post.id, nextCount);
                console.log(
                  `[row ${post.id}] render #${nextCount} | title="${post.title}"`,
                );
              });
              return (<li
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
              </li>);
            }}
          </For>
        </ul>
      </Show>
    </main>
  );
}
