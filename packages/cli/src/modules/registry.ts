import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DrxError } from '../errors.js'
import { fetchJson } from '../fetch-json.js'
import { isRecord } from '../validate.js'
import { parseModuleRegistry, type ModuleEntry } from './entry.js'

/** The published Druxt module registry. */
export const DEFAULT_MODULE_REGISTRY =
  'https://cdn.jsdelivr.net/gh/druxt/modules@main/modules.json'

/**
 * A cached copy younger than this is used with no request. The registry
 * changes when a module is released, and the CDN in front of it holds a
 * branch for hours, so asking more often than hourly finds nothing new.
 */
export const FRESH_FOR_MS = 60 * 60 * 1000

export interface LoadedModules {
  modules: ModuleEntry[]
  url: string
  /** `remote` when the registry was read now, `cache` for the copy on disk. */
  origin: 'remote' | 'cache'
  /** When the registry was read from its URL, as an ISO date and time. */
  fetchedAt: string
  ageMs: number
  /** Why the registry could not be read, when an old copy stood in for it. */
  reason?: string
}

export interface LoadModulesOptions {
  url: string
  /** The directory the copy is kept in. */
  cacheDir: string
  now?: () => Date
  fetch?: typeof fetch
  /** Read the registry even when the copy is fresh. */
  refresh?: boolean
  /** A bearer token for a registry the user named. */
  auth?: string
}

interface Cached {
  modules: ModuleEntry[]
  fetchedAt: Date
}

/** One file per registry URL, named by a hash of the URL. */
function cacheFile(cacheDir: string, url: string): string {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 16)
  return join(cacheDir, 'modules', `${key}.json`)
}

/** The copy on disk, or undefined when there is none that can be read. */
async function readCache(
  file: string,
  url: string
): Promise<Cached | undefined> {
  try {
    const stored: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!isRecord(stored) || stored.url !== url) return undefined
    const fetchedAt = new Date(String(stored.fetchedAt))
    if (Number.isNaN(fetchedAt.getTime())) return undefined
    return { modules: parseModuleRegistry(stored.registry, url), fetchedAt }
  } catch {
    return undefined
  }
}

/**
 * Loads the module registry.
 *
 * A copy on disk under an hour old is used as it is. Otherwise the registry
 * is read from its URL and the copy replaced. When that read fails, a copy of
 * any age is used and the result says why. A registry that is read but is
 * invalid, or of another schema version, is an error and never falls back.
 */
export async function loadModules(
  options: LoadModulesOptions
): Promise<LoadedModules> {
  const { url, cacheDir } = options
  const now = (options.now ?? (() => new Date()))()
  const file = cacheFile(cacheDir, url)
  const cached = await readCache(file, url)

  const fromCache = (copy: Cached, reason?: string): LoadedModules => ({
    modules: copy.modules,
    url,
    origin: 'cache',
    fetchedAt: copy.fetchedAt.toISOString(),
    ageMs: Math.max(0, now.getTime() - copy.fetchedAt.getTime()),
    ...(reason === undefined ? {} : { reason }),
  })

  if (
    cached &&
    !options.refresh &&
    now.getTime() - cached.fetchedAt.getTime() < FRESH_FOR_MS
  ) {
    return fromCache(cached)
  }

  let registry: unknown
  try {
    registry = await fetchJson(url, options.fetch, options.auth)
  } catch (error) {
    if (!(error instanceof DrxError)) throw error
    if (cached) return fromCache(cached, error.message)
    throw new DrxError(
      'registry',
      `${error.message} There is no cached copy to use.`
    )
  }

  const modules = parseModuleRegistry(registry, url)
  const fetchedAt = now.toISOString()
  try {
    await mkdir(join(cacheDir, 'modules'), { recursive: true })
    await writeFile(file, JSON.stringify({ url, fetchedAt, registry }))
  } catch {
    // A cache directory that cannot be written costs a request next time.
  }
  return { modules, url, origin: 'remote', fetchedAt, ageMs: 0 }
}

/** An age as a phrase: "less than a minute", "3 hours", "2 days". */
export function describeAge(ms: number): string {
  const count = (value: number, unit: string) =>
    `${value} ${unit}${value === 1 ? '' : 's'}`
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'less than a minute'
  if (minutes < 60) return count(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return count(hours, 'hour')
  return count(Math.floor(hours / 24), 'day')
}
