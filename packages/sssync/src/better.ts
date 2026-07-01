import { Result } from 'better-result'

export type Report =
  | { readonly type: 'http'; readonly offending: { status: number; statusText: string; url: string } | { error: unknown } }
  | { readonly type: 'validation'; readonly offending: unknown }
  | { readonly type: 'url'; readonly offending: unknown }
  | { readonly type: 'persistence'; readonly offending: { store: string; key?: string; error: unknown } }
  | { readonly type: 'store'; readonly offending: { type: 'INSERT' | 'UPDATE' | 'DELETE'; table: string } }
  | { readonly type: 'mutator'; readonly offending: unknown }

export type Reported = Report & {
  where: 'batcher' | 'bootstrap' | 'coverage' | 'sssync' | 'store'
}

// Renders a Report as a human-readable line at the logging/display boundary.
// Discrimination stays on `type`; the string is always derived, never stored.
export function describe(report: Report): string {
  switch (report.type) {
    case 'http': {
      const o = report.offending
      return 'error' in o ? `Fetch failed: ${String(o.error)}` : `HTTP ${o.status} ${o.statusText} for ${o.url}`
    }
    case 'validation':
      return `Validation failed for ${JSON.stringify(report.offending)}`
    case 'url':
      return `Invalid URL: ${JSON.stringify(report.offending)}`
    case 'persistence': {
      const o = report.offending
      return `Persistence error in ${o.store}${o.key ? ` (${o.key})` : ''}: ${String(o.error)}`
    }
    case 'store':
      return `${report.offending.type} dropped: no live "${report.offending.table}" row`
    case 'mutator':
      return typeof report.offending === 'string'
        ? `Unknown mutator: ${report.offending}`
        : `Mutator error: ${String(report.offending)}`
    default: {
      const never: never = report
      return `Unknown error: ${JSON.stringify(never)}`
    }
  }
}

class HTTPError extends Error {
  constructor(readonly response: Response) {
    super(`Fetch failed: ${response.status} ${response.statusText}`)
    this.name = 'HTTPError'
  }
}

class JSONParseError extends Error {
  constructor(
    readonly text: string,
    readonly originalError: unknown,
  ) {
    super('Response body was not valid JSON')
    this.name = 'JSONParseError'
  }
}

export async function fetchJSON<T = unknown>(input: RequestInfo | URL, init?: RequestInit) {
  return Result.tryPromise({
    try: async () => {
      const response = await fetch(input, init)
      if (!response.ok) throw new HTTPError(response)
      const text = await response.text()
      try {
        return JSON.parse(text) as T
      } catch (error) {
        throw new JSONParseError(text, error)
      }
    },
    catch: errorFor,
  })
}

function errorFor(error: unknown): Report {
  if (error instanceof HTTPError) {
    return {
      type: 'http',
      offending: {
        status: error.response.status,
        statusText: error.response.statusText,
        url: error.response.url,
      },
    }
  }

  if (error instanceof JSONParseError) {
    return { type: 'validation', offending: error.text }
  }

  return { type: 'http', offending: { error } }
}
