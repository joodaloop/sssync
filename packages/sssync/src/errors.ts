export type HttpFailure = {
  readonly type: 'http'
  readonly offending: { status: number; statusText: string; url: string } | { error: unknown }
}
export type ValidationFailure = { readonly type: 'validation'; readonly offending: unknown }
export type UrlFailure = { readonly type: 'url'; readonly offending: unknown }
export type PersistenceFailure = {
  readonly type: 'persistence'
  readonly offending: { store: string; key?: string; error: unknown }
}
export type MutatorFailure = { readonly type: 'mutator'; readonly offending: unknown }

export type Failure = HttpFailure | ValidationFailure | UrlFailure | PersistenceFailure | MutatorFailure

export type Reported = Failure & {
  where: 'batcher' | 'bootstrap' | 'coverage' | 'sssync'
}

// Renders a Failure as a human-readable line at the logging/display boundary.
// Discrimination stays on `type`; the string is always derived, never stored.
export function describe(failure: Failure): string {
  switch (failure.type) {
    case 'http': {
      const o = failure.offending
      return 'error' in o ? `Fetch failed: ${String(o.error)}` : `HTTP ${o.status} ${o.statusText} for ${o.url}`
    }
    case 'validation':
      return `Validation failed for ${JSON.stringify(failure.offending)}`
    case 'url':
      return `Invalid URL: ${JSON.stringify(failure.offending)}`
    case 'persistence': {
      const o = failure.offending
      return `Persistence error in ${o.store}${o.key ? ` (${o.key})` : ''}: ${String(o.error)}`
    }
    case 'mutator':
      return typeof failure.offending === 'string'
        ? `Unknown mutator: ${failure.offending}`
        : `Mutator error: ${String(failure.offending)}`
    default: {
      const never: never = failure
      return `Unknown error: ${JSON.stringify(never)}`
    }
  }
}
