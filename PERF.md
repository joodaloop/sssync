time-to-first-insert: Many storages run lazy, so it makes no sense to compare the time which is required to create a database with collections. Instead we measure the time-to-first-insert which is the whole timespan from database creation until the first single document write is done.
insert documents (bulk): Insert 500 documents with a single bulk-insert operation.
find documents by id (bulk): Here we fetch 100% of the stored documents with a single findByIds() call.
insert documents (serial): Insert 50 documents, one after each other.
find documents by id (serial): Here we find 50 documents in serial with one findByIds() call per document.
find documents by query: Here we fetch 100% of the stored documents with a single find() call.
find documents by query: Here we fetch all of the stored documents with a 4 find() calls that run in parallel. Each fetching 25% of the documents.
count documents: Counts 100% of the stored documents with a single count() call. Here we measure 4 runs at once to have a higher number that is easier to compare.
