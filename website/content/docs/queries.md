---
title: Querying data
---

SSSync provides the following operations:
- Access all items of a table: `sss.issues` returns an array-like Solid store that auto-updates when it's items change.
- Access a single item: `sss.issues.one("id_123")` returns a Solid store that contains a single table row or `null` until the row matches. 
- Access to linked items: `sss.issues.one("id_123").related("comments")` returns an Solid store that contains the item + a nested array of the related items.

These queries are used to construct requests to the server, in the format outlined in the [The SSSync Server Protocol](/server) page.
