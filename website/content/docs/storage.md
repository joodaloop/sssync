---
title: Tables & persistence
---

Schema is declared using [Zero schema](https://zero.rocicorp.dev/docs/schema), which produces validators, etc. 

Data is stored in IndexedDB tables, with the schema hash used as the database name. 
A "databases" table will keep track of upgrade version, schema hashing, etc.

Will need functions for bulk storing rows, reading all data out of the database into Map(), and validating all the time.

SSSync can be configured with either "idb" or "memory" adapters. Tree-shakeable.
