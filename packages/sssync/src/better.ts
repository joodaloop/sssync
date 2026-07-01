import { Result } from 'better-result'
import type { Result as ResultType } from 'better-result'

import type { HttpReport, ValidationReport } from './boundaries'

export type { HttpReport, ValidationReport }

export type UrlReport = { readonly type: 'url'; readonly offending: unknown }
export type PersistenceReport = {
  readonly type: 'persistence'
  readonly offending: { store: string; key?: string; error: unknown }
}
export type MutatorReport = { readonly type: 'mutator'; readonly offending: unknown }

export type Report = HttpReport | ValidationReport | UrlReport | PersistenceReport | MutatorReport

export type Reported = Report & {
  where: 'batcher' | 'bootstrap' | 'coverage' | 'sssync'
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

export async function fetchJSON<T = unknown>(input: RequestInfo | URL, init?: RequestInit) {
  const text = await fetchText(input, init)

  return text.andThen(parseJSON<T>)
}

async function fetchText(input: RequestInfo | URL, init?: RequestInit): Promise<ResultType<string, HttpReport>> {
  const response = await Result.tryPromise({
    try: () => fetch(input, init),
    catch: (error): HttpReport => ({ type: 'http', offending: { error } }),
  })

  return response.andThenAsync(fetched => {
    if (!fetched.ok) {
      return Promise.resolve(
        Result.err<string, HttpReport>({
          type: 'http',
          offending: {
            status: fetched.status,
            statusText: fetched.statusText,
            url: fetched.url,
          },
        }),
      )
    }

    return Result.tryPromise({
      try: () => fetched.text(),
      catch: (error): HttpReport => ({ type: 'http', offending: { error } }),
    })
  })
}

function parseJSON<T>(text: string): ResultType<T, ValidationReport> {
  return Result.try<T, ValidationReport>({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fetchJSON<T> is a typed JSON boundary.
    try: () => JSON.parse(text) as unknown as Awaited<T>,
    catch: () => ({ type: 'validation', offending: text }),
  })
}
