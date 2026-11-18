import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
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

const configFile = (dir: string) =>
  CONFIG_FILES.find((candidate) => existsSync(join(dir, candidate)))

/**
 * The steps that add a package to the part and list it in the config. The
 * install comes first, so a failed one leaves the config as it was. What the
 * steps do, and what was there already, is kept for the project's record.
 */
async function addModule(
  dir: string,
  name: string | undefined
): Promise<ModuleChange> {
  const change = emptyChange()
  if (!name) return change
  const did: PackageRecord = { installed: false, listed: false }
  change.did = did

  const manager = packageManager(dir)
  if (name in (await declared(dir))) {
    change.notes.push(`${name} is already a dependency in package.json.`)
  } else {
    change.steps.push({
      run: { tool: manager.tool, args: [manager.add, name] },
    })
    did.installed = true
  }

  const file = configFile(dir)
  if (!file) {
    change.manual.push(
      `Add '${name}' to the modules array of the config. No config file was found.`
    )
    return change
  }
  const edit = editModules(await readFile(join(dir, file), 'utf8'), name, 'add')
  if (edit.kind === 'changed') {
    change.steps.push({
      edit: {
        file,
        content: edit.content,
        summary: `Add '${name}' to modules in ${file}`,
      },
    })
    did.listed = true
  } else if (edit.kind === 'unsafe') {
    change.manual.push(
      `Add '${name}' to the modules array in ${file}. It could not be edited safely.`
    )
  } else {
    change.notes.push(`${name} is already in modules in ${file}.`)
  }
  return change
}

/**
 * The steps that take away what an add did: the package when it installed
 * it, and the entry in the config when it wrote it. What the part had before
 * stays, and so does everything when the record does not say who put it
 * there.
 */
async function removeModule(
  dir: string,
  name: string | undefined,
  did: PackageRecord | undefined
): Promise<ModuleChange> {
  const change = emptyChange()
  if (!name) return change

  const manager = packageManager(dir)
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
        run: { tool: manager.tool, args: [manager.remove, name] },
      })
    } else {
      change.notes.push(
        `${name} was in package.json before drx add, so it stays.`
      )
    }
  }
  if (!file || !edit || !listed) return change
  if (!did.listed) {
    change.notes.push(
      `${name} was in modules in ${file} before drx add, so it stays.`
    )
  } else if (edit.kind === 'changed') {
    change.steps.push({
      edit: {
        file,
        content: edit.content,
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

  addModule: (dir, request) => addModule(dir, request.package),
  removeModule: (dir, request) =>
    removeModule(dir, request.package, request.did),
}
