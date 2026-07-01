import { Result } from 'better-result'

import type { StandardSchemaV1 } from './types'

export type Issue = StandardSchemaV1.Issue

export type Validator<Output> = StandardSchemaV1<unknown, Output>

type Check<Output> = (value: unknown, path: readonly PropertyKey[]) => Output

const vendor = 'sssync'

function validator<Output>(check: Check<Output>): Validator<Output> {
  return {
    '~standard': {
      version: 1,
      vendor,
      validate(value) {
        // eslint-disable-next-line no-restricted-syntax -- schema boundary: converts the throw-based
        // check/run machinery into StandardSchema's return-based { issues } contract.
        try {
          return { value: check(value, []) }
        } catch (error) {
          return {
            issues: [
              error instanceof ValidationError
                ? error.issue
                : { message: error instanceof Error ? error.message : String(error) },
            ],
          }
        }
      },
    },
  }
}

export function safeValidate<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  value: unknown,
): Result<Output, readonly Issue[]> {
  const result = schema['~standard'].validate(value)
  if (result instanceof Promise) {
    throw new Error('Async schemas are not supported')
  }
  if (result.issues) {
    return Result.err(result.issues)
  }
  return Result.ok(result.value)
}

export function string(): Validator<string> {
  return validator((value, path) => {
    if (typeof value !== 'string') {
      throw issueError(path, `Expected string but received ${describe(value)}`)
    }
    return value
  })
}

export function number(): Validator<number> {
  return validator((value, path) => {
    if (typeof value !== 'number') {
      throw issueError(path, `Expected number but received ${describe(value)}`)
    }
    return value
  })
}

export function boolean(): Validator<boolean> {
  return validator((value, path) => {
    if (typeof value !== 'boolean') {
      throw issueError(path, `Expected boolean but received ${describe(value)}`)
    }
    return value
  })
}

export function nullValue(): Validator<null> {
  return validator((value, path) => {
    if (value !== null) {
      throw issueError(path, `Expected null but received ${describe(value)}`)
    }
    return value
  })
}

export function unknown(): Validator<unknown> {
  return validator(value => value)
}

export function nullable<Output>(schema: Validator<Output>): Validator<Output | null> {
  return validator((value, path) => (value === null ? null : run(schema, value, path)))
}

export function optional<Output>(schema: Validator<Output>): Validator<Output | undefined> {
  return validator((value, path) => (value === undefined ? undefined : run(schema, value, path)))
}

export function enums<const T extends readonly (string | number | boolean)[]>(values: T): Validator<T[number]> {
  const allowed = new Set<unknown>(values)
  return validator((value, path) => {
    if (!allowed.has(value)) {
      const expected = values.map(v => JSON.stringify(v)).join(' | ')
      throw issueError(path, `Expected one of ${expected} but received ${describe(value)}`)
    }
    return value as T[number]
  })
}

export function object<const Shape extends Record<string, Validator<unknown>>>(
  shape: Shape,
): Validator<{
  readonly [K in keyof Shape]: Shape[K] extends Validator<infer Output> ? Output : never
}> {
  type Out = { readonly [K in keyof Shape]: Shape[K] extends Validator<infer Output> ? Output : never }
  return validator((value, path) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw issueError(path, `Expected object but received ${describe(value)}`)
    }

    const input = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, schema] of Object.entries(shape)) {
      const validated = run(schema, input[key], [...path, key])
      if (validated !== undefined || key in input) {
        output[key] = validated
      }
    }
    return output as Out
  })
}

function run<Output>(schema: Validator<Output>, value: unknown, _path: readonly PropertyKey[]): Output {
  const result = schema['~standard'].validate(value)
  if (result instanceof Promise) {
    throw new Error('Async schemas are not supported')
  }
  if (result.issues) {
    throw new ValidationError(result.issues[0] ?? { message: 'Invalid value' })
  }
  return result.value
}

class ValidationError extends Error {
  constructor(readonly issue: Issue) {
    super(issue.message)
  }
}

function issueError(path: readonly PropertyKey[], message: string): ValidationError {
  return new ValidationError({ message, path: pathFor(path) })
}

function pathFor(path: readonly PropertyKey[]): Issue['path'] | undefined {
  return path.length === 0 ? undefined : path
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
