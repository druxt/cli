import { existsSync, realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { loadConfig } from 'c12'
import type { BackendRecord, PackageRecord } from './adapters/adapter.js'
import { DrxError } from './errors.js'
import { isLayout, LAYOUTS, type Layout } from './layouts.js'
import { partsProblem, type Part } from './parts.js'
import { isNonEmptyString, isRecord } from './validate.js'

const nodeRequire = createRequire(import.meta.url)

/** The file at a project's root that says how the project is laid out. */
export const CONFIG_FILE = 'drx.config.json'

/**
 * What `init` records about a site, so later commands know where its parts
 * are. The registry a starter came from is not recorded: a private registry
 * stays in the user configuration and out of the project.
 */
export interface ProjectConfig {
  layout: Layout
  /** The Druxt release line, such as `0.x`. */
  line: string
  /** The name of the starter the project was created from. */
  starter: string
  /** The name of the source its Druxt packages come from. */
  source: string
  parts: Part[]
  /** What `drx add` did, so `drx remove` undoes that and no more. */
  modules?: ModuleRecord[]
}

/**
 * One module the CLI added to the project, with what it did to each part.
 * What it found in place is recorded as not done, so a remove leaves it.
 */
export interface ModuleRecord {
  /** The name of the module in the registry. */
  name: string
  /** Its frontend package. */
  package: string
  /**
   * What was done to each frontend part, by the part's path. Undefined in a
   * record written before this was kept, which does not say.
   */
  frontend?: ({ path: string } & PackageRecord)[]
  /** What was done to each backend part, by the part's path. */
  backend: ({ path: string } & BackendRecord)[]
}

type Raw = Record<string, unknown>
const rawList = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.filter(isRecord) : []

/**
 * A record as this version keeps it, read from any version's. An older one
 * lists only the backend modules it required, all of which it also enabled,
 * and has nothing on the frontend or on which module a patch was for.
 */
function moduleRecord(raw: Raw): ModuleRecord {
  return {
    name: raw.name as string,
    package: raw.package as string,
    ...(Array.isArray(raw.frontend)
      ? {
          frontend: rawList(raw.frontend).map((entry) => ({
            path: String(entry.path),
            installed: entry.installed === true,
            listed: entry.listed === true,
          })),
        }
      : {}),
    backend: rawList(raw.backend).map((entry) => ({
      path: String(entry.path),
      modules: rawList(entry.modules).map((module) => ({
        name: String(module.name),
        ...(typeof module.package === 'string'
          ? { package: module.package }
          : {}),
        enabled: module.enabled !== false,
        required: module.required !== false,
      })),
      patches: rawList(entry.patches).map((patch) => ({
        package: String(patch.package),
        description: String(patch.description),
        url: String(patch.url),
        ...(typeof patch.module === 'string' ? { module: patch.module } : {}),
      })),
    })),
  }
}

export async function writeProjectConfig(
  root: string,
  config: ProjectConfig
): Promise<string> {
  const file = join(root, CONFIG_FILE)
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`)
  return file
}

/** The nearest directory at or above `cwd` that holds the config file. */
export function findProjectRoot(cwd: string): string | undefined {
  let dir = resolve(cwd)
  while (!existsSync(join(dir, CONFIG_FILE))) {
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return dir
}

function configProblem(config: Record<string, unknown>): string | undefined {
  if (!isLayout(config.layout)) {
    return `layout must be one of ${LAYOUTS.join(', ')}`
  }
  for (const key of ['line', 'starter', 'source']) {
    if (!isNonEmptyString(config[key])) {
      return `${key} must be a non-empty string`
    }
  }
  const parts = partsProblem(config.parts, 'parts')
  if (parts) return parts

  const modules = config.modules
  if (modules === undefined) return undefined
  if (!Array.isArray(modules)) return 'modules must be an array'
  for (const [index, module] of modules.entries()) {
    const at = `modules[${index}]`
    for (const key of ['name', 'package']) {
      if (!isRecord(module) || !isNonEmptyString(module[key])) {
        return `${at}.${key} must be a non-empty string`
      }
    }
    if (!Array.isArray((module as Record<string, unknown>).backend)) {
      return `${at}.backend must be an array`
    }
  }
  return undefined
}

/** Reads and checks the config file of the project rooted at `root`. */
export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  const file = join(root, CONFIG_FILE)
  let config: Record<string, unknown>
  try {
    // c12 loads a JSON file through Node's require, which keeps the first
    // read for the life of the process. Forgetting it reads the file as it is
    // now, which matters to anything that calls the CLI more than once.
    for (const cached of [file, realpathSync(file)]) {
      delete nodeRequire.cache[cached]
    }
    // The file is read on its own: no rc file, no package.json key, no
    // environment overrides and no `extends`, so what is in it is all there is.
    const loaded = await loadConfig<Record<string, unknown>>({
      cwd: root,
      configFile: CONFIG_FILE,
      rcFile: false,
      globalRc: false,
      packageJson: false,
      dotenv: false,
      envName: false,
      extend: false,
      giget: false,
    })
    config = loaded.config
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new DrxError('config', `${file} could not be read: ${detail}`)
  }
  const problem = configProblem(config)
  if (problem) throw new DrxError('config', `${file} is invalid: ${problem}.`)
  return {
    layout: config.layout as Layout,
    line: config.line as string,
    starter: config.starter as string,
    source: config.source as string,
    parts: config.parts as Part[],
    ...(config.modules
      ? { modules: (config.modules as Raw[]).map(moduleRecord) }
      : {}),
  }
}
