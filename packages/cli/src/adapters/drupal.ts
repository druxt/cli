import { join } from 'node:path'
import { isRecord } from '../validate.js'
import {
  addModuleNotAvailable,
  type KindAdapter,
  type PackageVersion,
} from './adapter.js'
import { readJsonObject, stringMap } from './read-json.js'

/** Any of these in `require` makes a Composer project a Drupal site. */
const CORE = ['drupal/core-recommended', 'drupal/core']
const REPORTED = [...CORE, 'drupal/druxt']

async function required(dir: string): Promise<Record<string, string>> {
  return stringMap(await readJsonObject(join(dir, 'composer.json')), 'require')
}

/** The version of each package in composer.lock. */
async function locked(dir: string): Promise<Map<string, string>> {
  const lock = await readJsonObject(join(dir, 'composer.lock'))
  const versions = new Map<string, string>()
  for (const key of ['packages', 'packages-dev']) {
    const packages = lock?.[key]
    if (!Array.isArray(packages)) continue
    for (const entry of packages) {
      if (
        isRecord(entry) &&
        typeof entry.name === 'string' &&
        typeof entry.version === 'string'
      ) {
        versions.set(entry.name, entry.version)
      }
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

  async packages(dir) {
    const requires = await required(dir)
    const versions = await locked(dir)
    return REPORTED.filter((name) => name in requires).map(
      (name): PackageVersion => ({
        name,
        range: requires[name] ?? null,
        installed: versions.get(name) ?? null,
      })
    )
  },

  addModule: addModuleNotAvailable,
}
