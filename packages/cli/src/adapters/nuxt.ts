import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  addModuleNotAvailable,
  type KindAdapter,
  type PackageVersion,
} from './adapter.js'
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

  addModule: addModuleNotAvailable,
}
