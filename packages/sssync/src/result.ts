/**
 * A returned error is a value, not an exception: a fallible call hands back
 * either an `ok` value or an `error` tagged union (e.g. `Failure`). Callers
 * discriminate on `ok` and thread failures with early returns — no throwing, no
 * `instanceof`, no wrapper class.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

/**
 * The single sanctioned exception→value boundary. Wraps a throwing third-party
 * call and turns whatever it throws into a returned tagged-union error via
 * `onError`. Composition elsewhere stays flat (`if (!x.ok) return x`); this is
 * the only place a `try/catch` lives.
 */
export function attempt<T, E>(fn: () => T, onError: (error: unknown) => E): Result<T, E> {
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- the one audited spot where a thrown exception is converted into a returned Result.
  try {
    return ok(fn())
  } catch (error) {
    return err(onError(error))
  }
}

/** The async counterpart to {@link attempt}, for throwing `Promise`-returning calls. */
export async function attemptAsync<T, E>(
  fn: () => Promise<T>,
  onError: (error: unknown) => E,
): Promise<Result<T, E>> {
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- the one audited spot where a thrown exception is converted into a returned Result.
  try {
    return ok(await fn())
  } catch (error) {
    return err(onError(error))
  }
}

/**
 * An unrecoverable error: a bug, not a failure. Where a {@link Result} models an
 * expected failure that callers are meant to handle, a `Panic` signals a broken
 * invariant that should crash loudly rather than be threaded through `Result`.
 * The original cause (if any) is appended to the stack for debugging.
 */
export class Panic extends Error {
  readonly _tag = 'Panic'

  static is(value: unknown): value is Panic {
    return value instanceof Panic
  }

  constructor(args: { message: string; cause?: unknown }) {
    super(args.message, args.cause === undefined ? undefined : { cause: args.cause })
    this.name = 'Panic'
    if (args.cause instanceof Error && args.cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${args.cause.stack}`
    }
  }
}

/** Type guard for {@link Panic} instances. */
export const isPanic = (value: unknown): value is Panic => Panic.is(value)

/** Throw an unrecoverable {@link Panic}. Never returns. */
export function panic(message: string, cause?: unknown): never {
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- a panic is a deliberate crash for an unrecoverable bug, not a threaded Result.
  throw new Panic({ message, cause })
}
