import { adapterFor, kindsWithRole } from '../adapters/index.js'
import { DrxError } from '../errors.js'
import { isNonEmptyString, isNpmName, isRecord } from '../validate.js'

/** The registry format this version reads. */
export const MODULE_SCHEMA_VERSION = 1

/** A backend module a Druxt module needs, and the kind of backend it is for. */
export interface BackendModule {
  kind: string
  /** The machine name of the module. */
  name: string
  label: string
  /**
   * Whether the backend ships the module itself, as the registry states it.
   * Undefined when the registry does not say.
   */
  core?: boolean
  url?: string
}

/**
 * One module of the registry, with the fields the CLI uses. The registry
 * holds more, and is free to add to them.
 */
export interface ModuleEntry {
  name: string
  /** The package to install. A module that is not released has none. */
  npm?: string
  repo: string
  /** Where the module is inside its repository. */
  path?: string
  category: string
  status: string
  type: string
  archived: boolean
  description: string
  website?: string
  /**
   * The Druxt versions the module works with, as the registry states it: a
   * semver range, the word `unknown`, or undefined when it says nothing.
   */
  druxt?: string
  backend: BackendModule[]
}

type Raw = Record<string, unknown>

class Invalid extends Error {}

function requiredString(raw: Raw, key: string, at: string): string {
  if (!isNonEmptyString(raw[key])) {
    throw new Invalid(`${at}.${key} must be a non-empty string`)
  }
  return raw[key]
}

function optionalString(raw: Raw, key: string, at: string): string | undefined {
  const value = raw[key]
  if (value !== undefined && typeof value !== 'string') {
    throw new Invalid(`${at}.${key} must be a string`)
  }
  return value
}

function optionalBoolean(raw: Raw, key: string, at: string): boolean {
  const value = raw[key]
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Invalid(`${at}.${key} must be true or false`)
  }
  return value ?? false
}

/**
 * The backend modules of an entry. The registry lists them under a key named
 * after the kind of backend, so each backend kind that has an adapter is
 * looked up by its own name.
 */
function backendModules(raw: Raw, at: string): BackendModule[] {
  const modules: BackendModule[] = []
  for (const kind of kindsWithRole('backend')) {
    const list = raw[kind]
    if (list === undefined) continue
    if (!Array.isArray(list))
      throw new Invalid(`${at}.${kind} must be an array`)
    for (const [index, item] of list.entries()) {
      const here = `${at}.${kind}[${index}]`
      if (!isRecord(item)) throw new Invalid(`${here} must be an object`)
      const url = optionalString(item, 'url', here)
      // Checked for its type, and kept only when it is there.
      const core = optionalBoolean(item, 'core', here)
      const module: BackendModule = {
        kind,
        name: requiredString(item, 'name', here),
        label: requiredString(item, 'label', here),
        ...(item.core === undefined ? {} : { core }),
        ...(url === undefined ? {} : { url }),
      }
      // The kind says what its tools take, so a value is never an option.
      const problem = adapterFor(kind)?.moduleProblem?.(module)
      if (problem) throw new Invalid(`${here}.${problem.field} ${problem.must}`)
      modules.push(module)
    }
  }
  return modules
}

function moduleEntry(raw: unknown, at: string): ModuleEntry {
  if (!isRecord(raw)) throw new Invalid(`${at} must be an object`)

  const compatibility = raw.compatibility
  if (compatibility !== undefined && !isRecord(compatibility)) {
    throw new Invalid(`${at}.compatibility must be an object`)
  }
  const druxt = compatibility
    ? optionalString(compatibility, 'druxt', `${at}.compatibility`)
    : undefined

  const name = requiredString(raw, 'name', at)
  const repo = requiredString(raw, 'repo', at)
  const category = requiredString(raw, 'category', at)
  const status = requiredString(raw, 'status', at)
  const type = requiredString(raw, 'type', at)
  const npm = optionalString(raw, 'npm', at)
  // An empty name is a module with no package. Any other is an argument of
  // a package manager one day, so it has to be a name and nothing else.
  if (npm !== undefined && npm !== '' && !isNpmName(npm)) {
    throw new Invalid(`${at}.npm must be the name of an npm package`)
  }
  const path = optionalString(raw, 'path', at)
  const website = optionalString(raw, 'website', at)

  return {
    name,
    ...(npm === undefined ? {} : { npm }),
    repo,
    ...(path === undefined ? {} : { path }),
    category,
    status,
    type,
    archived: optionalBoolean(raw, 'archived', at),
    description: optionalString(raw, 'description', at) ?? '',
    ...(website === undefined ? {} : { website }),
    ...(druxt === undefined ? {} : { druxt }),
    backend: backendModules(raw, at),
  }
}

/**
 * Checks a module registry and returns its entries. A field the CLI does not
 * use is ignored. A `schemaVersion` it does not know is refused, since the
 * fields it does use may have changed meaning.
 */
export function parseModuleRegistry(
  raw: unknown,
  location: string
): ModuleEntry[] {
  const invalid = (problem: string) =>
    new DrxError(
      'registry',
      `The module registry at ${location} is invalid: ${problem}.`
    )

  if (!isRecord(raw)) throw invalid('it must be an object')
  if (typeof raw.schemaVersion !== 'number') {
    throw invalid('schemaVersion must be a number')
  }
  if (raw.schemaVersion !== MODULE_SCHEMA_VERSION) {
    throw new DrxError(
      'registry',
      `The module registry at ${location} has schemaVersion ${raw.schemaVersion}, and this version of the CLI reads schemaVersion ${MODULE_SCHEMA_VERSION}. Update @druxt/cli to read it.`
    )
  }
  if (!Array.isArray(raw.modules)) throw invalid('modules must be an array')

  try {
    return raw.modules.map((entry, index) =>
      moduleEntry(entry, `modules[${index}]`)
    )
  } catch (error) {
    if (error instanceof Invalid) throw invalid(error.message)
    throw error
  }
}
