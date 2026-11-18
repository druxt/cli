import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DrxError } from './errors.js'
import { isHttpUrl, isNonEmptyString, isRecord } from './validate.js'
import {
  DEFAULT_SOURCE,
  SOURCE_TYPES,
  type SourceDefinition,
} from './sources.js'

/**
 * The user's own configuration: registries and sources by name. A private
 * registry or source is named here, on the user's machine, and nowhere in
 * this package.
 */
export interface UserConfig {
  /** The file the configuration was read from, or would be. */
  path: string
  registries: Record<string, string>
  sources: Record<string, SourceDefinition>
}

type Env = Record<string, string | undefined>

export function userConfigPath(env: Env): string {
  if (env.DRX_CONFIG) return env.DRX_CONFIG
  const base = env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), '.config')
  return join(base, 'drx', 'config.json')
}

/** The first problem with the parsed file, or undefined when it is valid. */
function configProblem(config: unknown): string | undefined {
  if (!isRecord(config)) return 'it must hold an object'

  const registries = config.registries ?? {}
  if (!isRecord(registries)) return 'registries must be an object of URLs'
  for (const [name, url] of Object.entries(registries)) {
    if (!isHttpUrl(url))
      return `registries.${name} must be an http or https URL`
  }

  const sources = config.sources ?? {}
  if (!isRecord(sources)) return 'sources must be an object'
  for (const [name, source] of Object.entries(sources)) {
    const at = `sources.${name}`
    if (name === DEFAULT_SOURCE) {
      return `${at} cannot redefine the built-in source`
    }
    if (!isRecord(source)) return `${at} must be an object`
    if (!SOURCE_TYPES.includes(source.type as (typeof SOURCE_TYPES)[number])) {
      return `${at}.type must be one of ${SOURCE_TYPES.join(', ')}`
    }
    if (source.type === 'git' && !isNonEmptyString(source.url)) {
      return `${at}.url must be a non-empty string`
    }
    for (const key of ['tag', 'ref']) {
      if (source[key] !== undefined && typeof source[key] !== 'string') {
        return `${at}.${key} must be a string`
      }
    }
  }
  return undefined
}

/**
 * Reads the user configuration. A missing file is an empty configuration,
 * unless DRX_CONFIG named it.
 */
export async function loadUserConfig(env: Env): Promise<UserConfig> {
  const path = userConfigPath(env)
  if (!existsSync(path)) {
    if (env.DRX_CONFIG) {
      throw new DrxError(
        'config',
        `DRX_CONFIG names ${path}, which does not exist.`
      )
    }
    return { path, registries: {}, sources: {} }
  }

  const invalid = (problem: string) =>
    new DrxError('config', `${path} is invalid: ${problem}.`)

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw invalid('it is not valid JSON')
  }
  const problem = configProblem(parsed)
  if (problem) throw invalid(problem)

  const config = parsed as Partial<UserConfig>
  return {
    path,
    registries: config.registries ?? {},
    sources: config.sources ?? {},
  }
}

/** Turns a `--registry` value into a URL: a URL, or a configured name. */
export function resolveRegistryUrl(value: string, config: UserConfig): string {
  // An own key only: every object has a `constructor`.
  const named = Object.hasOwn(config.registries, value)
    ? config.registries[value]
    : undefined
  if (named) return named
  if (isHttpUrl(value)) return value
  const names = Object.keys(config.registries).sort()
  const defined = names.length > 0 ? ` Defined names: ${names.join(', ')}.` : ''
  throw new DrxError(
    'usage',
    `--registry takes a URL or a name defined in ${config.path}. "${value}" is neither.${defined}`
  )
}
