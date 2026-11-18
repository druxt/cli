import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DrxError } from '../errors.js'
import { bundledRegistryDir } from '../package-root.js'
import { isRecord, isStringArray } from '../validate.js'
import { validateEntry, type StarterEntry } from './entry.js'

/**
 * The public registry: the starters/ directory of druxt/cli, read as raw
 * files. A registry is any URL that answers `/<name>.json`, which is the
 * format giget defines, plus an `index.json` that lists the names.
 */
export const DEFAULT_REGISTRY =
  'https://raw.githubusercontent.com/druxt/cli/0.x/starters'

const TIMEOUT_MS = 10_000

export interface Registry {
  /** `remote` for a URL, `bundled` for the copy inside the package. */
  origin: 'remote' | 'bundled'
  /** The URL, or the directory of the bundled copy. */
  location: string
  /** Why the default registry was not used, when the bundled copy was. */
  fallbackReason?: string
  /** The starter names the registry lists. */
  names(): Promise<string[]>
  /** One entry, validated. */
  entry(name: string): Promise<StarterEntry>
}

export interface OpenRegistryOptions {
  /** A registry the user named. It is never replaced by the bundled copy. */
  url?: string
  defaultUrl?: string
  bundledDir?: string
  fetch?: typeof fetch
  /** A bearer token for a registry the user named. */
  auth?: string
}

type ReadJson = (file: string) => Promise<unknown>

function assertStarterName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new DrxError(
      'unknown-starter',
      `A starter name may hold letters, digits, dots, dashes and underscores: "${name}".`
    )
  }
}

function remoteReader(
  base: string,
  fetcher: typeof fetch,
  auth?: string
): ReadJson {
  return async (file) => {
    const url = `${base}/${file}`
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
}

function bundledReader(dir: string): ReadJson {
  return async (file) =>
    JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown
}

function namesFrom(index: unknown, label: string): string[] {
  const starters = isRecord(index) ? index.starters : undefined
  if (!isStringArray(starters)) {
    throw new DrxError(
      'registry',
      `${label} is invalid: starters must be an array of names.`
    )
  }
  return starters
}

function remoteRegistry(base: string, read: ReadJson): Registry {
  return {
    origin: 'remote',
    location: base,
    names: async () =>
      namesFrom(await read('index.json'), `${base}/index.json`),
    entry: async (name) => {
      assertStarterName(name)
      return validateEntry(await read(`${name}.json`), name)
    },
  }
}

function bundledRegistry(dir: string, fallbackReason: string): Registry {
  const read = bundledReader(dir)
  const names = async () =>
    namesFrom(await read('index.json'), join(dir, 'index.json'))
  return {
    origin: 'bundled',
    location: dir,
    fallbackReason,
    names,
    entry: async (name) => {
      assertStarterName(name)
      const known = await names()
      if (!known.includes(name)) {
        throw new DrxError(
          'unknown-starter',
          `There is no starter named "${name}". The registry has: ${known.join(', ')}.`
        )
      }
      return validateEntry(await read(`${name}.json`), name)
    },
  }
}

/**
 * Opens the registry `init` reads starters from.
 *
 * A registry the user named is used as it is, and a failure to read it is an
 * error. The default registry is tried first when none is named, and the copy
 * bundled with the package takes its place when its index cannot be read.
 */
export async function openRegistry(
  options: OpenRegistryOptions = {}
): Promise<Registry> {
  const fetcher = options.fetch ?? fetch
  const trim = (url: string) => url.replace(/\/+$/, '')

  if (options.url) {
    const base = trim(options.url)
    return remoteRegistry(base, remoteReader(base, fetcher, options.auth))
  }

  const base = trim(options.defaultUrl ?? DEFAULT_REGISTRY)
  const remote = remoteRegistry(base, remoteReader(base, fetcher))
  try {
    const names = await remote.names()
    return { ...remote, names: async () => names }
  } catch (error) {
    if (!(error instanceof DrxError)) throw error
    return bundledRegistry(
      options.bundledDir ?? bundledRegistryDir(),
      error.message
    )
  }
}

/** The entry marked as the default, or undefined when none is. */
export async function defaultStarter(
  registry: Registry
): Promise<StarterEntry | undefined> {
  for (const name of await registry.names()) {
    const entry = await registry.entry(name)
    if (entry.druxt.default) return entry
  }
  return undefined
}
