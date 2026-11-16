import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  emptyChange,
  type KindAdapter,
  type ModuleChange,
  type PackageVersion,
} from './adapter.js'
import { editModules } from './nuxt-config.js'
import { readJsonObject, stringMap } from './read-json.js'

const CONFIG_FILES = ['js', 'ts', 'mjs', 'cjs', 'mts'].map(
  (extension) => `nuxt.config.${extension}`
)

/** The framework itself, then the Druxt packages of either naming scheme. */
const FRAMEWORK = 'nuxt'
const DRUXT_PACKAGE = /^(druxt|druxt-.+|@druxt\/.+)$/

/** The package that is Druxt itself, under each naming scheme. */
const DRUXT_CORE = ['druxt', '@druxt/core']

async function declared(dir: string): Promise<Record<string, string>> {
  const manifest = await readJsonObject(join(dir, 'package.json'))
  return {
    ...stringMap(manifest, 'devDependencies'),
    ...stringMap(manifest, 'dependencies'),
  }
}

/** The version of a package in the part's node_modules, or null. */
async function installedVersion(
  dir: string,
  name: string
): Promise<string | null> {
  const manifest = await readJsonObject(
    join(dir, 'node_modules', name, 'package.json')
  )
  return typeof manifest?.version === 'string' ? manifest.version : null
}

async function packageVersion(
  dir: string,
  name: string
): Promise<PackageVersion | undefined> {
  const range = (await declared(dir))[name] ?? null
  const installed = await installedVersion(dir, name)
  if (range === null && installed === null) return undefined
  return { name, range, installed }
}

/** The package manager of a part, by the lock file it keeps. */
const MANAGERS = [
  { lock: 'pnpm-lock.yaml', tool: 'pnpm', add: 'add', remove: 'remove' },
  { lock: 'yarn.lock', tool: 'yarn', add: 'add', remove: 'remove' },
  { lock: 'bun.lock', tool: 'bun', add: 'add', remove: 'remove' },
  { lock: 'bun.lockb', tool: 'bun', add: 'add', remove: 'remove' },
] as const
const NPM = { tool: 'npm', add: 'install', remove: 'uninstall' } as const

function packageManager(dir: string) {
  return MANAGERS.find(({ lock }) => existsSync(join(dir, lock))) ?? NPM
}

/**
 * The steps that add a package to the part and list it in the config, or
 * that take both away again. The install comes first, so a failed one leaves
 * the config as it was.
 */
async function changeModule(
  dir: string,
  name: string | undefined,
  action: 'add' | 'remove'
): Promise<ModuleChange> {
  const change = emptyChange()
  if (!name) return change

  const manager = packageManager(dir)
  const dependency = name in (await declared(dir))
  if (action === 'add' && dependency) {
    change.notes.push(`${name} is already a dependency in package.json.`)
  } else if (action === 'add' || dependency) {
    change.steps.push({
      run: { tool: manager.tool, args: [manager[action], name] },
    })
  }

  const file = CONFIG_FILES.find((candidate) =>
    existsSync(join(dir, candidate))
  )
  if (!file) {
    if (action === 'add') {
      change.manual.push(
        `Add '${name}' to the modules array of the config. No config file was found.`
      )
    }
    return change
  }

  const edit = editModules(
    await readFile(join(dir, file), 'utf8'),
    name,
    action
  )
  if (edit.kind === 'changed') {
    change.steps.push({
      edit: {
        file,
        content: edit.content,
        summary:
          action === 'add'
            ? `Add '${name}' to modules in ${file}`
            : `Remove '${name}' from modules in ${file}`,
      },
    })
  } else if (edit.kind === 'unsafe') {
    change.manual.push(
      action === 'add'
        ? `Add '${name}' to the modules array in ${file}. It could not be edited safely.`
        : `Remove '${name}' from the modules array in ${file}. It could not be edited safely.`
    )
  } else if (action === 'add') {
    change.notes.push(`${name} is already in modules in ${file}.`)
  }
  return change
}

export const nuxtAdapter: KindAdapter = {
  kind: 'nuxt',
  role: 'frontend',

  async detect(dir) {
    if (CONFIG_FILES.some((file) => existsSync(join(dir, file)))) return true
    return FRAMEWORK in (await declared(dir))
  },

  async packages(dir) {
    const ranges = await declared(dir)
    const names = Object.keys(ranges)
      .filter((name) => name === FRAMEWORK || DRUXT_PACKAGE.test(name))
      .sort((a, b) =>
        a === FRAMEWORK ? -1 : b === FRAMEWORK ? 1 : a.localeCompare(b)
      )

    const versions: PackageVersion[] = []
    for (const name of names) {
      versions.push({
        name,
        range: ranges[name] ?? null,
        installed: await installedVersion(dir, name),
      })
    }
    return versions
  },

  async druxt(dir) {
    for (const name of DRUXT_CORE) {
      const found = await packageVersion(dir, name)
      if (found) return found
    }
    return undefined
  },

  package: packageVersion,

  addModule: (dir, request) => changeModule(dir, request.package, 'add'),
  removeModule: (dir, request) => changeModule(dir, request.package, 'remove'),
}
