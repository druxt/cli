import { join } from 'node:path'
import { isRecord } from '../validate.js'
import type { KindAdapter, PackageVersion } from './adapter.js'
import { moduleProblem } from './drupal-fields.js'
import { planBackendAdd, planBackendRemove } from './drupal-modules.js'
import { readJsonObject, stringMap } from './read-json.js'

/** Any of these in `require` makes a Composer project a Drupal site. */
const CORE = ['drupal/core-recommended', 'drupal/core']
const REPORTED = [...CORE, 'drupal/druxt']

async function required(dir: string): Promise<Record<string, string>> {
  return stringMap(await readJsonObject(join(dir, 'composer.json')), 'require')
}

/** The version of each package Composer has installed, which is none until `composer install` has run. */
async function installed(dir: string): Promise<Map<string, string>> {
  const manifest = await readJsonObject(
    join(dir, 'vendor', 'composer', 'installed.json')
  )
  const versions = new Map<string, string>()
  const packages = manifest?.packages
  if (!Array.isArray(packages)) return versions
  for (const entry of packages) {
    if (
      isRecord(entry) &&
      typeof entry.name === 'string' &&
      typeof entry.version === 'string'
    ) {
      versions.set(entry.name, entry.version)
    }
  }
  return versions
}

export const drupalAdapter: KindAdapter = {
  kind: 'drupal',
  role: 'backend',

  async detect(dir) {
    const requires = await required(dir)
    return CORE.some((name) => name in requires)
  },

  moduleProblem,

  async packages(dir) {
    const requires = await required(dir)
    const versions = await installed(dir)
    return REPORTED.filter((name) => name in requires).map(
      (name): PackageVersion => ({
        name,
        range: requires[name] ?? null,
        installed: versions.get(name) ?? null,
      })
    )
  },

  // The Druxt packages a module registry lists are frontend packages.
  druxt: async () => undefined,
  package: async () => undefined,

  addModule: planBackendAdd,
  removeModule: planBackendRemove,
}
