import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
      const installed = await installedManifest(dir, name)
      versions.push({
        name,
        range: ranges[name] ?? null,
        installed:
          typeof installed?.version === 'string' ? installed.version : null,
      })
    }
    return versions
  },

  addModule: addModuleNotAvailable,
}
