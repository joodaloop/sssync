import { Result } from 'better-result'

export type Report = {
  readonly type: 'validation' | 'url' | 'http' | 'persistence' | 'store'
  readonly offending: unknown
}

export type Reported = Report & {
  where: 'batcher' | 'bootstrap' | 'coverage' | 'sssync'
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

export async function fetchJSON<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
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

  return { type: 'http', offending: error }
}
