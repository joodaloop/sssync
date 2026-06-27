---
title: Tables & persistence
---

Schema is declared using [Zero schema](https://zero.rocicorp.dev/docs/schema), which produces validators, etc. 

Data is stored in IndexedDB tables, with the schema hash used as the database name. 
A "databases" table will keep track of upgrade version, schema hashing, etc.

Will need functions for bulk storing rows, reading all data out of the database into Map(), and validating all the time.

SSSync can be configured with either "idb" or "memory" adapters. Tree-shakeable.


```js
{
  name: 'linear_296285d9d399ac9fa0a6ffa3912f109b',
  createdAt: 1782578364787,
  userId: 'a4fcb064-a41e-4082-9b47-9b10b2e66f29',
  schemaHash: 'bb68955e032c43a09a9e83c4f43da32a',
  schemaVersion: 3,
  version: 63
}
```
