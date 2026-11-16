import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'
import type { BackendModule } from '../modules/entry.js'
import { isRecord } from '../validate.js'
import {
  emptyChange,
  type AddRequest,
  type BackendRecord,
  type ModuleChange,
  type RemoveRequest,
} from './adapter.js'

/** The Composer plugin that applies patches, and the line the quickstart is on. */
const PATCHES_PLUGIN = 'cweagans/composer-patches'
const PATCHES_PLUGIN_CONSTRAINT = '^2.0@beta'

type Json = Record<string, unknown>
type Patches = Record<string, Record<string, string>>

interface Manifest {
  source: string
  json: Json
  require: Record<string, unknown>
  patches: Patches
}

async function readManifest(dir: string): Promise<Manifest | undefined> {
  try {
    const source = await readFile(join(dir, 'composer.json'), 'utf8')
    const json: unknown = JSON.parse(source)
    if (!isRecord(json)) return undefined
    const extra = isRecord(json.extra) ? json.extra : {}
    return {
      source,
      json,
      require: isRecord(json.require) ? json.require : {},
      patches: (isRecord(extra.patches) ? extra.patches : {}) as Patches,
    }
  } catch {
    return undefined
  }
}

/** The manifest as text, with the indent and final newline it had. */
function write(manifest: Manifest, json: Json): string {
  const indent = /^([ \t]+)"/m.exec(manifest.source)?.[1] ?? '    '
  const text = JSON.stringify(json, null, indent)
  return manifest.source.endsWith('\n') ? `${text}\n` : text
}

/** The directory core keeps its modules in, under the web root the site names. */
function coreModulesDir(dir: string, manifest: Manifest): string {
  const extra = isRecord(manifest.json.extra) ? manifest.json.extra : {}
  const scaffold = extra['drupal-scaffold']
  const locations = isRecord(scaffold) ? scaffold.locations : undefined
  const webRoot = isRecord(locations) ? locations['web-root'] : undefined
  return join(
    dir,
    typeof webRoot === 'string' ? webRoot : 'web',
    'core',
    'modules'
  )
}

/** The version of each package Composer has installed. */
async function installedVersions(dir: string): Promise<Map<string, string>> {
  const versions = new Map<string, string>()
  try {
    const installed: unknown = JSON.parse(
      await readFile(join(dir, 'vendor', 'composer', 'installed.json'), 'utf8')
    )
    const packages = isRecord(installed) ? installed.packages : undefined
    for (const entry of Array.isArray(packages) ? packages : []) {
      if (isRecord(entry) && typeof entry.name === 'string') {
        versions.set(entry.name, String(entry.version))
      }
    }
  } catch {
    // Nothing is installed yet.
  }
  return versions
}

const packageOf = (need: BackendModule) =>
  need.composer?.package ?? `drupal/${need.name}`

/**
 * Whether a module is core's own or a package to require.
 *
 * The registry's word is taken first. A registry that marks core modules
 * marks all of them, so in one that does, a module not marked is a package. A
 * package the site already requires is plainly a package. Past that the only
 * honest source is the core the site has installed, and without it the
 * answer is `unknown`. There is no list of core modules here to go stale.
 */
function origin(
  need: BackendModule,
  request: AddRequest,
  manifest: Manifest,
  coreDir: string
): 'core' | 'package' | 'unknown' {
  if (need.core) return 'core'
  if (request.registryStatesCore || need.composer) return 'package'
  if (packageOf(need) in manifest.require) return 'package'
  if (!existsSync(coreDir)) return 'unknown'
  return existsSync(join(coreDir, need.name)) ? 'core' : 'package'
}

/** The steps that add the backend modules a Druxt module needs. */
export async function planBackendAdd(
  dir: string,
  request: AddRequest
): Promise<ModuleChange> {
  const change = emptyChange()
  const { needs } = request
  if (needs.length === 0) return change

  const manifest = await readManifest(dir)
  if (!manifest) {
    change.problems.push(
      `There is no composer.json to add ${needs.map(({ name }) => name).join(', ')} to.`
    )
    return change
  }

  const coreDir = coreModulesDir(dir, manifest)
  const versions = await installedVersions(dir)
  const record: BackendRecord = { modules: [], patches: [] }
  const toRequire: string[] = []
  const patches: Patches = structuredClone(manifest.patches)
  let repatch = false

  for (const need of needs) {
    const pkg = packageOf(need)
    const from = origin(need, request, manifest, coreDir)
    if (from === 'unknown') {
      change.problems.push(
        `Cannot tell whether ${need.name} is part of core or a package to require: the module registry does not say, and core is not installed in this part to look in. Install the dependencies of the backend, then run this again.`
      )
      continue
    }
    if (from === 'package') {
      if (pkg in manifest.require) {
        change.notes.push(`${pkg} is already required in composer.json.`)
      } else {
        toRequire.push(
          need.composer?.constraint ? `${pkg}:${need.composer.constraint}` : pkg
        )
        record.modules.push({ name: need.name, package: pkg })
      }
    }

    for (const patch of need.patches ?? []) {
      const target = patch.package ?? pkg
      if (!request.patches) {
        change.warnings.push(
          `The patch "${patch.description}" for ${target} was not applied. ${need.label} may not work without it.`
        )
        continue
      }
      const has = versions.get(target)
      const fixed = patch.until ? semver.coerce(patch.until) : null
      const installed = has ? semver.coerce(has) : null
      if (fixed && installed && semver.gte(installed, fixed)) {
        change.notes.push(
          `The patch "${patch.description}" is not needed: ${target} ${has} has the fix, which came in ${patch.until}.`
        )
        continue
      }
      if (Object.values(patches[target] ?? {}).includes(patch.url)) {
        change.notes.push(
          `The patch "${patch.description}" is already in composer.json.`
        )
        continue
      }
      patches[target] = { ...patches[target], [patch.description]: patch.url }
      record.patches.push({
        package: target,
        description: patch.description,
        url: patch.url,
      })
      change.notes.push(
        `Patch for ${target}: ${patch.description}${patch.issue ? ` (${patch.issue})` : ''}`
      )
      // A package that is installed already has to be patched in place.
      if (target !== pkg || pkg in manifest.require) repatch = true
    }

    for (const step of need.setup ?? []) {
      change.after.push(`${need.label}: ${step.title}`)
      if (step.command) change.after.push(`  ${step.command}`)
      if (step.url) change.after.push(`  ${step.url}`)
    }
  }

  if (change.problems.length > 0) return change
  const composer = (...args: string[]) =>
    change.steps.push({ run: { tool: 'composer', args } })

  if (record.patches.length > 0) {
    const json = structuredClone(manifest.json)
    json.extra = { ...(isRecord(json.extra) ? json.extra : {}), patches }
    const hasPlugin = PATCHES_PLUGIN in manifest.require
    if (!hasPlugin) {
      // Allowed before it is required, or Composer stops to ask.
      const config = isRecord(json.config) ? json.config : {}
      const allowed = isRecord(config['allow-plugins'])
        ? config['allow-plugins']
        : {}
      json.config = {
        ...config,
        'allow-plugins': { ...allowed, [PATCHES_PLUGIN]: true },
      }
    }
    const count = record.patches.length
    change.steps.push({
      edit: {
        file: 'composer.json',
        content: write(manifest, json),
        summary: `Add ${count} patch${count === 1 ? '' : 'es'} to composer.json`,
      },
    })
    if (!hasPlugin) {
      composer('require', `${PATCHES_PLUGIN}:${PATCHES_PLUGIN_CONSTRAINT}`)
    }
    composer('patches-relock')
  }
  if (toRequire.length > 0) composer('require', ...toRequire)
  if (record.patches.length > 0 && repatch) composer('patches-repatch')
  change.steps.push({
    run: {
      tool: 'drush',
      args: ['en', '-y', ...needs.map(({ name }) => name)],
    },
  })

  change.record = record
  return change
}

/**
 * The steps that undo what an add did to the part: the modules it required
 * and the patches it wrote, and nothing the site's owner put there.
 */
export async function planBackendRemove(
  dir: string,
  request: RemoveRequest
): Promise<ModuleChange> {
  const change = emptyChange()
  const record = request.record
  if (!record) return change

  const going = record.modules.filter(
    ({ name }) => !request.stillNeeded.includes(name)
  )
  for (const { name } of record.modules) {
    if (!going.some((module) => module.name === name)) {
      change.notes.push(`${name} stays: another installed module needs it.`)
    }
  }
  if (going.length > 0) {
    change.steps.push({
      run: {
        tool: 'drush',
        args: ['pmu', '-y', ...going.map(({ name }) => name)],
      },
    })
  }

  // The record does not say which module a patch was for, so while any of
  // them stays, every patch does.
  const manifest = await readManifest(dir)
  let relock = false
  if (manifest && going.length === record.modules.length) {
    const patches: Patches = structuredClone(manifest.patches)
    let removed = 0
    for (const patch of record.patches) {
      const forPackage = patches[patch.package]
      if (forPackage?.[patch.description] !== patch.url) continue
      delete forPackage[patch.description]
      if (Object.keys(forPackage).length === 0) delete patches[patch.package]
      removed += 1
    }
    if (removed > 0) {
      const json = structuredClone(manifest.json)
      const extra = { ...(isRecord(json.extra) ? json.extra : {}) }
      if (Object.keys(patches).length === 0) delete extra.patches
      else extra.patches = patches
      json.extra = extra
      change.steps.push({
        edit: {
          file: 'composer.json',
          content: write(manifest, json),
          summary: `Remove ${removed} patch${removed === 1 ? '' : 'es'} from composer.json`,
        },
      })
      relock = true
    }
  }

  if (going.length > 0) {
    change.steps.push({
      run: {
        tool: 'composer',
        args: ['remove', ...going.map((module) => module.package)],
      },
    })
  }
  if (relock) {
    change.steps.push({ run: { tool: 'composer', args: ['patches-relock'] } })
  }
  return change
}
