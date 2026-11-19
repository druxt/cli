import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  emptyChange,
  type KindAdapter,
  type ModuleChange,
  type PackageRecord,
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

/**
 * The package.json of an installed package, as Node finds it from `dir`: in
 * the nearest node_modules on the way up, which is the project's root when
 * its workspaces are hoisted.
 */
async function installedManifest(dir: string, name: string) {
  for (let from = resolve(dir); ; from = dirname(from)) {
    const manifest = await readJsonObject(
      join(from, 'node_modules', name, 'package.json')
    )
    if (manifest || dirname(from) === from) return manifest
  }
}

/** The version of a package installed for the part, or null. */
async function installedVersion(
  dir: string,
  name: string
): Promise<string | null> {
  const manifest = await installedManifest(dir, name)
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

/**
 * The package managers a part may be installed with, each with its lock
 * files and the words it adds and removes a package with. `separator` is
 * true where the manager is known to take `--` before the names, so that a
 * name is never read as an option.
 */
const MANAGERS = [
  {
    tool: 'pnpm',
    locks: ['pnpm-lock.yaml'],
    add: 'add',
    remove: 'remove',
    separator: true,
  },
  {
    tool: 'yarn',
    locks: ['yarn.lock'],
    add: 'add',
    remove: 'remove',
    separator: true,
  },
  {
    tool: 'bun',
    locks: ['bun.lock', 'bun.lockb'],
    add: 'add',
    remove: 'remove',
    separator: false,
  },
  {
    tool: 'npm',
    locks: ['package-lock.json', 'npm-shrinkwrap.json'],
    add: 'install',
    remove: 'uninstall',
    separator: true,
  },
] as const
type Manager = (typeof MANAGERS)[number]
const NPM = MANAGERS[3]

/** The directories from the project's root down to the part, or the part. */
function fromRoot(dir: string, root: string | undefined): string[] {
  const part = resolve(dir)
  const top = root === undefined ? part : resolve(root)
  const down = relative(top, part)
  if (down === '') return [part]
  if (down.startsWith('..') || isAbsolute(down)) return [part]
  const dirs = [top]
  for (const segment of down.split(sep)) {
    dirs.push(join(dirs.at(-1) as string, segment))
  }
  return dirs
}

/**
 * The package manager of a part, found the way an install of the whole
 * project finds it. The manager a package.json declares in `packageManager`
 * comes first, looked for from the root of the project down to the part, so
 * a workspace is installed with the manager of its root. Without one, it is
 * the manager of the first lock file on the same way down, and npm when
 * there is no lock file either.
 */
async function packageManager(
  dir: string,
  root: string | undefined
): Promise<Manager> {
  const dirs = fromRoot(dir, root)
  for (const at of dirs) {
    const manifest = await readJsonObject(join(at, 'package.json'))
    const declared = String(manifest?.packageManager ?? '').split('@')[0]
    const manager = MANAGERS.find(({ tool }) => tool === declared)
    if (manager) return manager
  }
  for (const at of dirs) {
    const manager = MANAGERS.find(({ locks }) =>
      locks.some((lock) => existsSync(join(at, lock)))
    )
    if (manager) return manager
  }
  return NPM
}

/** The arguments that add or remove one package with a manager. */
const packageArgs = (manager: Manager, verb: 'add' | 'remove', name: string) =>
  manager.separator ? [manager[verb], '--', name] : [manager[verb], name]

/**
 * The change to the config that adds or removes a module, for the file as
 * it is when the change is made.
 */
const moduleEdit =
  (file: string, name: string, action: 'add' | 'remove') =>
  (source: string): string => {
    const edit = editModules(source, name, action)
    if (edit.kind === 'changed') return edit.content
    if (edit.kind === 'unchanged') return source
    throw new Error(
      `${file} has changed since it was read, and its modules can no longer be edited safely.`
    )
  }

const configFile = (dir: string) =>
  CONFIG_FILES.find((candidate) => existsSync(join(dir, candidate)))

/**
 * The steps that add a package to the part and list it in the config. The
 * install comes first, so a failed one leaves the config as it was. What the
 * steps do, and what was there already, is kept for the project's record.
 */
async function addModule(
  dir: string,
  name: string | undefined,
  root: string | undefined
): Promise<ModuleChange> {
  const change = emptyChange()
  if (!name) return change
  const did: PackageRecord = { installed: false, listed: false }
  change.did = did

  const manager = await packageManager(dir, root)
  if (name in (await declared(dir))) {
    change.notes.push(`${name} is already a dependency in package.json.`)
  } else {
    change.steps.push({
      run: { tool: manager.tool, args: packageArgs(manager, 'add', name) },
      did: { installed: true },
    })
    did.installed = true
  }

  const file = configFile(dir)
  if (!file) {
    change.manual.push(
      `Add '${name}' to the modules array of the config. No config file was found.`
    )
    did.byHand = true
    return change
  }
  const edit = editModules(await readFile(join(dir, file), 'utf8'), name, 'add')
  if (edit.kind === 'changed') {
    change.steps.push({
      edit: {
        file,
        change: moduleEdit(file, name, 'add'),
        summary: `Add '${name}' to modules in ${file}`,
      },
      did: { listed: true },
    })
    did.listed = true
  } else if (edit.kind === 'unsafe') {
    change.manual.push(
      `Add '${name}' to the modules array in ${file}. It could not be edited safely.`
    )
    did.byHand = true
  } else {
    change.notes.push(`${name} is already in modules in ${file}.`)
  }
  return change
}

/**
 * The steps that take away what an add did: the package when it installed
 * it, and the entry in the config when it wrote it. What the part had before
 * stays, and so does everything when the record does not say who put it
 * there. An entry the add left to the user is left to the user again: the
 * add could not read the config, so nothing says whether the entry is there.
 */
async function removeModule(
  dir: string,
  name: string | undefined,
  did: PackageRecord | undefined,
  root: string | undefined
): Promise<ModuleChange> {
  const change = emptyChange()
  if (!name) return change

  const manager = await packageManager(dir, root)
  const dependency = name in (await declared(dir))
  const file = configFile(dir)
  const edit = file
    ? editModules(await readFile(join(dir, file), 'utf8'), name, 'remove')
    : undefined
  const listed = edit !== undefined && edit.kind !== 'unchanged'

  if (!did) {
    if (dependency || listed) {
      change.manual.push(
        `The record does not say whether drx add installed ${name}, so it was left. To take it out: ${[
          ...(dependency ? [`${manager.tool} ${manager.remove} ${name}`] : []),
          ...(listed ? [`remove '${name}' from modules in ${file}`] : []),
        ].join(', and ')}.`
      )
    }
    return change
  }

  if (dependency) {
    if (did.installed) {
      change.steps.push({
        run: { tool: manager.tool, args: packageArgs(manager, 'remove', name) },
      })
    } else {
      change.notes.push(
        `${name} was in package.json before drx add, so it stays.`
      )
    }
  }
  if (did.byHand && !did.listed) {
    if (edit?.kind !== 'unchanged') {
      const where = file ? `in ${file}` : 'of the config'
      const why = file ? 'could not edit the file' : 'found no config file'
      change.manual.push(
        `Remove '${name}' from the modules array ${where}, if you added it there. drx add ${why} and left that line to you, so it is yours to take out.`
      )
    }
    return change
  }
  if (!file || !edit || !listed) return change
  if (!did.listed) {
    // Only a config that can be read says the entry is there.
    if (edit.kind === 'changed') {
      change.notes.push(
        `${name} was in modules in ${file} before drx add, so it stays.`
      )
    }
  } else if (edit.kind === 'changed') {
    change.steps.push({
      edit: {
        file,
        change: moduleEdit(file, name, 'remove'),
        summary: `Remove '${name}' from modules in ${file}`,
      },
    })
  } else {
    change.manual.push(
      `Remove '${name}' from the modules array in ${file}. It could not be edited safely.`
    )
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

  addModule: (dir, request) => addModule(dir, request.package, request.root),
  removeModule: (dir, request) =>
    removeModule(dir, request.package, request.did, request.root),
}
