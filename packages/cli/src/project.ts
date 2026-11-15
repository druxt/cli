import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { loadConfig } from 'c12'
import { DrxError } from './errors.js'
import { isLayout, LAYOUTS, type Layout } from './layouts.js'
import { partsProblem, type Part } from './parts.js'
import { isNonEmptyString } from './validate.js'

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
  return partsProblem(config.parts, 'parts')
}

/** Reads and checks the config file of the project rooted at `root`. */
export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  const file = join(root, CONFIG_FILE)
  let config: Record<string, unknown>
  try {
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
  }
}
