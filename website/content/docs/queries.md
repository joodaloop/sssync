---
title: Querying data
---

Accessing all items in a collection:
```tsx
// React
function IssueList(){
  const issues = useSync("issues")
  return (
    <div>
      {issues.elements.map(issue => <div> issue.title </div>)}
    </div>
  )
}

// Solid
function IssueList(){
  const issues = useSync("issues")
  return (
    <For each={issues()}>
      {(issue) => (<div> issue.title </div>)}
    </For>
  )
}
```

Accessing a single item (and relations of an item):
```tsx
// React
function IssueItem(){
  const user = useSync("users", {id: "id-me"}) // Promise<Issue | undefined>>
  const issue = useSync("issues", {id: "id-123", relations: ["comments"]}) // Promise<Issue | undefined & {comments: Comment[]>>
  return (
    <Suspense fallback="Loading issue details...">
      {(issue && user) && <div>Dear {user.firstName}, {issue.title} has {issue.comments.length} comments</div>}
    </Suspense>
  )
}

// Solid
function IssueItem(){
  const user = useSync("users", {id: "id-me"}) // useResource<Issue | undefined>>
  const issue = useSync("issues", {id: "id-123", relations: ["comments"]}) // useResource<Issue | undefined & {comments: Comment[]>>
  return (
    <Suspense fallback="Loading issue details...">
      <Show when={user() && issue()}
      {<div>Dear {user().firstName}, {issue().title} has {issue().comments.length} comments</div>}
    </Suspense>
  )
}
```

These queries are used to construct requests to the server, in the format outlined in the [The SSSync Server Protocol](/server) page.
