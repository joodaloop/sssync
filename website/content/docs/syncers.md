---
title: Syncers
---

Syncers are modules that keep the client database up to date. They get:
- Direct, read-only access to the client database 
- Mediated write access in the form of CREATE, UPDATE, and DELETE operations passed to the SSSync client, along with a SyncCursor.
