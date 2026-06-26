---
title: Events & Projectors
---

Writing data is done through events, these are named and versioned descriptions of user intent that will be converted into actual state changes by their matching projectors. As an example, an event that looks like:

```ts
{
  name: 'PostCreated_v1'
  data: {
    id: 'new_post_id',
    title: "Events & Projectors",
    description: "An explanation of the event system at the heart of SSSync"
  }
  deprecated: true, // will raise a type error if you try to create this event in your code
}
```

Might have a proejctor that looks like:
```ts
{
  // ... other projectors
  v1_PostCreated: (data) => {
    return [{
      type: 'CREATE',
      table: 'posts'
        itemId: data.id,
      item: { ...data, content: 'Coming soon!' }
    }]
  }
}
```

Which will result in a new post being inserted in the client database, updating the UI instantly. 

THese events are eventually sent to the backend in the form:
```ts
{
  name: 'v1_PostCreated'
  data: {
    title: "Events & Projectors"
    description: "An explanation of the event system at the heart of SSSync"
  },
  id: "evt_01J...",
  time: "2026-06-22T10:15:30Z",
}```
