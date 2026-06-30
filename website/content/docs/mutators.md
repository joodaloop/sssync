---
title: Mutators
---

Writing data is done through mutators, these are named and versioned descriptions of user intent.

THese mutators are eventually sent to the backend in the form:
```ts
{
  name: 'v1_PostCreated'
  data: {
    title: "Mutators"
    description: "An explanation of the event system at the heart of SSSync"
  },
  id: "evt_01J...",
  time: "2026-06-22T10:15:30Z",
}```

- `experimentalPendingMutations()` — inspect not-yet-confirmed local mutations.
- `mutationID`, `reason` (`'initial' | 'rebase' | 'authoritative'`)
