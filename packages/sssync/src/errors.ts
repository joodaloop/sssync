export type SyncError =
  | SchemaDefinitionError
  | QueryError
  | PrimaryKeyError
  | StoreMutationError
  | MutatorError
  | ValidationError
  | BootstrapError
  | BatchError
  | CoverageError
  | PersistenceError
  | ChannelError
  | LeaderElectionError

export type SSSyncError = SyncError

export type ErrorIssue = {
  readonly message: string
  readonly path?: readonly PropertyKey[] | undefined
}

export type ErrorCause = {
  readonly message: string
  readonly name?: string | undefined
  readonly stack?: string | undefined
}

export type HttpFailure = {
  readonly status: number
  readonly statusText: string
  readonly url: string
}

export type SchemaDefinitionError =
  | {
      readonly type: 'schema.duplicate_table'
      readonly table: string
    }
  | {
      readonly type: 'schema.duplicate_relationships'
      readonly table: string
    }
  | {
      readonly type: 'schema.missing_primary_key'
      readonly table: string
    }
  | {
      readonly type: 'schema.invalid_primary_key'
      readonly table: string
      readonly column: string
      readonly reason: 'json_column' | 'missing_column'
    }
  | {
      readonly type: 'schema.relationship_name_conflict'
      readonly table: string
      readonly relationship: string
      readonly column: string
    }
  | {
      readonly type: 'schema.relationship_missing_table'
      readonly table: string
      readonly relationship: string
      readonly destinationTable: string
    }
  | {
      readonly type: 'schema.relationship_missing_field'
      readonly table: string
      readonly relationship: string
      readonly sourceTable: string
      readonly field: string
    }

export type QueryError =
  | {
      readonly type: 'query.unknown_table'
      readonly table: string
      readonly operation: 'all' | 'one'
    }
  | {
      readonly type: 'query.unknown_relation'
      readonly table: string
      readonly relation: string
    }

export type PrimaryKeyError =
  | {
      readonly type: 'primary_key.invalid_input'
      readonly table: string
      readonly expected: 'scalar' | 'object'
      readonly received:
        | 'null'
        | 'array'
        | 'object'
        | 'string'
        | 'number'
        | 'boolean'
        | 'undefined'
        | 'symbol'
        | 'bigint'
        | 'function'
    }
  | {
      readonly type: 'primary_key.missing_field'
      readonly table: string
      readonly field: string
    }

export type StoreMutationError =
  | {
      readonly type: 'store.unknown_table'
      readonly table: string
      readonly mutation: 'INSERT' | 'UPDATE' | 'DELETE'
    }
  | {
      readonly type: 'store.invalid_mutation'
      readonly table?: string | undefined
      readonly reason: 'missing_table' | 'missing_type' | 'unknown_type' | 'invalid_id' | 'invalid_data' | 'invalid_changes'
    }

export type MutatorError =
  | {
      readonly type: 'mutator.envelope_not_object'
    }
  | {
      readonly type: 'mutator.envelope_name_not_string'
    }
  | {
      readonly type: 'mutator.unknown_mutation'
      readonly mutation: string
    }
  | {
      readonly type: 'mutator.async_args_schema'
      readonly mutation: string
    }
  | {
      readonly type: 'mutator.invalid_args'
      readonly mutation: string
      readonly issues: readonly ErrorIssue[]
    }
  | {
      readonly type: 'mutator.effect_failed'
      readonly mutation: string
      readonly cause: ErrorCause
    }

export type ValidationError =
  | {
      readonly type: 'validation.async_schema'
      readonly context: 'row' | 'mutator_args' | 'channel_message' | 'custom'
    }
  | {
      readonly type: 'validation.value_failed'
      readonly context: 'row' | 'mutator_args' | 'channel_message' | 'custom'
      readonly issues: readonly ErrorIssue[]
    }
  | {
      readonly type: 'validation.invalid_json'
      readonly context: 'bootstrap_response' | 'batch_response' | 'channel_message' | 'storage_record'
      readonly cause: ErrorCause
    }

export type BootstrapError =
  | {
      readonly type: 'bootstrap.unknown_model'
      readonly model: string
    }
  | {
      readonly type: 'bootstrap.fetch_failed'
      readonly model: string
      readonly url: string
      readonly cause: ErrorCause
    }
  | {
      readonly type: 'bootstrap.http_failed'
      readonly model: string
      readonly response: HttpFailure
    }
  | {
      readonly type: 'bootstrap.response_missing_data'
      readonly model: string
    }
  | {
      readonly type: 'bootstrap.response_data_not_array'
      readonly model: string
    }
  | {
      readonly type: 'bootstrap.invalid_row'
      readonly model: string
      readonly issues: readonly ErrorIssue[]
    }

export type BatchError =
  | {
      readonly type: 'batch.fetch_failed'
      readonly items: readonly RequestedItem[]
      readonly url: string
      readonly cause: ErrorCause
    }
  | {
      readonly type: 'batch.http_failed'
      readonly items: readonly RequestedItem[]
      readonly response: HttpFailure
    }
  | {
      readonly type: 'batch.response_not_object'
      readonly items: readonly RequestedItem[]
    }
  | {
      readonly type: 'batch.response_unknown_model'
      readonly model: string
      readonly items: readonly RequestedItem[]
    }
  | {
      readonly type: 'batch.response_rows_not_array'
      readonly model: string
      readonly items: readonly RequestedItem[]
    }
  | {
      readonly type: 'batch.invalid_row'
      readonly model: string
      readonly items: readonly RequestedItem[]
      readonly issues: readonly ErrorIssue[]
    }

export type CoverageError = {
  readonly type: 'coverage.request_failed'
  readonly item: RequestedItem
  readonly retryable: boolean
}

export type PersistenceError =
  | {
      readonly type: 'persistence.unavailable'
      readonly reason: 'disabled' | 'unsupported' | 'blocked' | 'unknown'
      readonly cause?: ErrorCause | undefined
    }
  | {
      readonly type: 'persistence.open_failed'
      readonly database: string
      readonly cause: ErrorCause
    }
  | {
      readonly type: 'persistence.schema_mismatch'
      readonly expectedSchemaVersion: number
      readonly actualSchemaVersion?: number | undefined
      readonly expectedSchemaHash?: string | undefined
      readonly actualSchemaHash?: string | undefined
    }
  | {
      readonly type: 'persistence.read_failed'
      readonly store: string
      readonly key?: string | undefined
      readonly cause: ErrorCause
    }
  | {
      readonly type: 'persistence.write_failed'
      readonly store: string
      readonly key?: string | undefined
      readonly cause: ErrorCause
    }
  | {
      readonly type: 'persistence.transaction_failed'
      readonly stores: readonly string[]
      readonly mode: 'readonly' | 'readwrite'
      readonly cause: ErrorCause
    }
  | {
      readonly type: 'persistence.quota_exceeded'
      readonly store?: string | undefined
      readonly cause: ErrorCause
    }

export type ChannelError =
  | {
      readonly type: 'channel.unavailable'
      readonly channel: string
      readonly cause?: ErrorCause | undefined
    }
  | {
      readonly type: 'channel.invalid_message'
      readonly channel: string
      readonly issues: readonly ErrorIssue[]
    }
  | {
      readonly type: 'channel.listener_failed'
      readonly channel: string
      readonly cause: ErrorCause
    }
  | {
      readonly type: 'channel.close_failed'
      readonly channel: string
      readonly cause: ErrorCause
    }

export type LeaderElectionError =
  | {
      readonly type: 'leader.unsupported'
      readonly lockName: string
    }
  | {
      readonly type: 'leader.request_failed'
      readonly lockName: string
      readonly cause: ErrorCause
    }
  | {
      readonly type: 'leader.listener_failed'
      readonly lockName: string
      readonly cause: ErrorCause
    }

export type RequestedItem = {
  readonly modelName: string
  readonly id: unknown
  readonly relation?: string | undefined
}
