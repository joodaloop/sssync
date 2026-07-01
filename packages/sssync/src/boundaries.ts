import type { HttpFailure, ValidationFailure } from './errors'
import { attempt, attemptAsync, err, type Result } from './result'

export async function fetchJSON<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Result<T, HttpFailure | ValidationFailure>> {
  const text = await fetchText(input, init)
  if (!text.ok) return text

  return parseJSON<T>(text.value)
}

async function fetchText(input: RequestInfo | URL, init?: RequestInit): Promise<Result<string, HttpFailure>> {
  const response = await attemptAsync(
    () => fetch(input, init),
    (error): HttpFailure => ({ type: 'http', offending: { error } }),
  )
  if (!response.ok) return response

  const fetched = response.value
  if (!fetched.ok) {
    return err<HttpFailure>({
      type: 'http',
      offending: {
        status: fetched.status,
        statusText: fetched.statusText,
        url: fetched.url,
      },
    })
  }

  return attemptAsync(
    () => fetched.text(),
    (error): HttpFailure => ({ type: 'http', offending: { error } }),
  )
}

function parseJSON<T>(text: string): Result<T, ValidationFailure> {
  return attempt(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fetchJSON<T> is a typed JSON boundary.
    () => JSON.parse(text) as T,
    (): ValidationFailure => ({ type: 'validation', offending: text }),
  )
}
