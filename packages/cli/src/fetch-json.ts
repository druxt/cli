import { DrxError } from './errors.js'

const TIMEOUT_MS = 10_000

/**
 * Fetches a URL and parses it as JSON. Every way it can fail is one error
 * that starts "Could not read <url>", so a caller can fall back on it.
 */
export async function fetchJson(
  url: string,
  fetcher: typeof fetch = fetch,
  auth?: string
): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, {
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new DrxError('registry', `Could not read ${url}: ${detail}.`)
  }
  if (!response.ok) {
    throw new DrxError(
      'registry',
      `Could not read ${url}: ${response.status} ${response.statusText}.`
    )
  }
  try {
    return JSON.parse(await response.text()) as unknown
  } catch {
    throw new DrxError(
      'registry',
      `Could not read ${url}: it is not valid JSON.`
    )
  }
}
