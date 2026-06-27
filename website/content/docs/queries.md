---
title: Querying data
---

Accessing all items in a collection:
```tsx
// React: returns a tuple
function IssueList() {
  const [issues, pending] = SSS.useAll("issues")
  // issues: Issue[]        — empty [] until ready (or undefined; see note)
  // pending: boolean       — true on initial load, false once authoritative
  if (pending) return <Spinner />

  return (
    <div>
      {issues.map((issue) => (
        <div key={issue.id}>{issue.title}</div>
      ))}
    </div>
  )
}

// Solid: returns an async memo accessor
function IssueList() {
  const issues = SSS.useAll("issues")
  // issues: () => Issue[]   — async memo accessor; reading it suspends until ready
  return (
    <Loading fallback={<Spinner />}>
      <For each={issues()}>
        {(issue) => <div>{issue.title}</div>}
      </For>
    </Loading>
  )
}
```

Accessing a single item (and relations of an item):
```tsx
// React
function IssueItem(){
  const [user, userPending] = SSS.useOne("users", { id: "id-me" })
  // user: User | undefined
  const [issue, issuePending] = SSS.useOne("issues", { id: "id-123", relations: ["comments"] })
  // issue: (Issue & { comments: Comment[] }) | undefined

  if (userPending || issuePending) return <Spinner />
  if (!user || !issue) return null // not-found (resolved but absent)

  return <div>Dear {user.firstName}, {issue.title} has {issue.comments.length} comments</div>
}

// Solid
function IssueItem() {
  const user = SSS.useOne("users", { id: "id-me" })
  // useOne returns an async memo accessor: () => User | undefined
  const issue = SSS.useOne("issues", { id: "id-123", relations: ["comments"] })
  // () => (Issue & { comments: Comment[] }) | undefined

  return (
    <Loading fallback={<Spinner />}>
      <Show when={user() && issue()} fallback={<div>Not found</div>}>
        <div>
          Dear {user()!.firstName}, {issue()!.title} has{" "}
          {issue()!.comments.length} comments
        </div>
      </Show>
    </Loading>
  )
}
```

These queries are used to construct requests to the server, in the format outlined in the [The SSSync Server Protocol](/server) page.
