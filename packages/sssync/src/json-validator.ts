import type { StandardSchemaV1 } from './types'

export type Issue = StandardSchemaV1.Issue

export type Validator<Output> = StandardSchemaV1<unknown, Output>

type ValidationResult<Output> =
  | { readonly success: true; readonly output: Output }
  | { readonly success: false; readonly issues: readonly Issue[] }

type Check<Output> = (value: unknown, path: readonly PropertyKey[]) => Output

const vendor = 'sssync'

export function validator<Output>(check: Check<Output>): Validator<Output> {
  return {
    '~standard': {
      version: 1,
      vendor,
      validate(value) {
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
): ValidationResult<Output> {
  const result = schema['~standard'].validate(value)
  if (result instanceof Promise) {
    throw new Error('Async schemas are not supported')
  }
  if (result.issues) {
    return { success: false, issues: result.issues }
  }
  return { success: true, output: result.value }
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

export function picklist<const Values extends readonly [unknown, ...unknown[]]>(
  values: Values,
): Validator<Values[number]> {
  return validator((value, path) => {
    if (!values.includes(value)) {
      throw issueError(path, `Expected one of ${values.map(String).join(', ')} but received ${describe(value)}`)
    }
    return value as Values[number]
  })
}

export function optional<Output>(schema: Validator<Output>): Validator<Output | undefined> {
  return validator((value, path) => (value === undefined ? undefined : run(schema, value, path)))
}

export function nullable<Output>(schema: Validator<Output>): Validator<Output | null> {
  return validator((value, path) => (value === null ? null : run(schema, value, path)))
}

export function array<Output>(item: Validator<Output>): Validator<readonly Output[]> {
  return validator((value, path) => {
    if (!Array.isArray(value)) {
      throw issueError(path, `Expected array but received ${describe(value)}`)
    }
    return value.map((entry, index) => run(item, entry, [...path, index]))
  })
}

export function minLength<Output extends { readonly length: number }>(
  schema: Validator<Output>,
  length: number,
): Validator<Output> {
  return validator((value, path) => {
    const output = run(schema, value, path)
    if (output.length < length) {
      throw issueError(path, `Expected length to be at least ${length}`)
    }
    return output
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

export function record<Output>(
  key: Validator<string>,
  value: Validator<Output>,
): Validator<Readonly<Record<string, Output>>> {
  return validator((input, path) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw issueError(path, `Expected object record but received ${describe(input)}`)
    }
    const output: Record<string, Output> = {}
    for (const [entryKey, entryValue] of Object.entries(input)) {
      run(key, entryKey, [...path, entryKey])
      output[entryKey] = run(value, entryValue, [...path, entryKey])
    }
    return output
  })
}

export function tuple<const Items extends readonly Validator<unknown>[]>(
  items: Items,
): Validator<{
  readonly [K in keyof Items]: Items[K] extends Validator<infer Output> ? Output : never
}> {
  return validator((value, path) => {
    if (!Array.isArray(value) || value.length !== items.length) {
      throw issueError(path, `Expected tuple of length ${items.length}`)
    }
    return items.map((item, index) => run(item, value[index], [...path, index])) as any
  })
}

export function union<const Options extends readonly Validator<unknown>[]>(
  options: Options,
): Validator<Options[number] extends Validator<infer Output> ? Output : never> {
  return validator((value, path) => {
    const issues: Issue[] = []
    for (const option of options) {
      const result = safeValidate(option, value)
      if (result.success) return result.output as any
      issues.push(...result.issues)
    }
    throw new ValidationError({
      message: issues[0]?.message ?? 'No union variant matched',
      path: pathFor(path),
    })
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
