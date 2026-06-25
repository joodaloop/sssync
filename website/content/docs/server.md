---
title: The SSSync Server Protocol
---

You will need to provide two endpoints. 

### Batch endpoint
The server receives `{model: "issue", id: 1, relation?: "comments"}` and has to be able to satisfy that request, for all relations that the client schema has. Possible return values are:
- 200 -> Array of relations object (will count as satisfaction)
- 400 -> Authorization error (will not be retried)
- 500 -> Server error (will be retried)

### Bootstrap endpoint
`/bootstrap?models=issue,project`

These 3 things can be composed to achieve:
- **Range scans/search:** Make a regular fetch() request that returns ids of elements, then just hydrate elements with those ids by calling .single(id) for each element.
- **Core or delayed bootstrap:** Choose when to call the bootstrap function for a model, and track it's completion to know when to block rendering of parts of the app.
- **Fetch-on-access:** Through visiting .single(id) or .related(model), which triggers the correct batch call when needed.
