import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import semver from 'semver'
import type { BackendModule } from '../modules/entry.js'
import { isRecord } from '../validate.js'
import {
  emptyChange,
  type AddRequest,
  type Ask,
  type BackendRecord,
  type ModuleChange,
  type RemoveRequest,
} from './adapter.js'

/** The Composer plugin that applies patches, and the line the quickstart is on. */
const PATCHES_PLUGIN = 'cweagans/composer-patches'
const PATCHES_PLUGIN_CONSTRAINT = '^2.0@beta'
const PATCHES_PLUGIN_MAJOR = 2

type Json = Record<string, unknown>
type Patches = Record<string, Record<string, string>>

interface Manifest {
  json: Json
  require: Record<string, unknown>
  patches: Patches
}

async function readManifest(dir: string): Promise<Manifest | undefined> {
  try {
    const json: unknown = JSON.parse(
      await readFile(join(dir, 'composer.json'), 'utf8')
    )
    if (!isRecord(json)) return undefined
    const extra = isRecord(json.extra) ? json.extra : {}
    return {
      json,
      require: isRecord(json.require) ? json.require : {},
      patches: (isRecord(extra.patches) ? extra.patches : {}) as Patches,
    }
  } catch {
    return undefined
  }
}

/** A manifest as text, with the indent and final newline its source had. */
function write(source: string, json: Json): string {
  const indent = /^([ \t]+)"/m.exec(source)?.[1] ?? '    '
  const text = JSON.stringify(json, null, indent)
  return source.endsWith('\n') ? `${text}\n` : text
}

/** The manifest a step finds when it runs, which may not be the one planned from. */
function parseManifest(source: string): Json {
  let json: unknown
  try {
    json = JSON.parse(source)
  } catch {
    json = undefined
  }
  if (!isRecord(json)) {
    throw new Error('composer.json can no longer be read as a JSON object.')
  }
  return json
}

const extraOf = (json: Json): Json => (isRecord(json.extra) ? json.extra : {})

/** A copy of the patches a manifest lists, by package and description. */
function patchesOf(json: Json): Patches {
  const { patches } = extraOf(json)
  return isRecord(patches) ? (structuredClone(patches) as Patches) : {}
}

type RecordedPatch = BackendRecord['patches'][number]

/**
 * The manifest with patches added, and the patches plugin allowed when
 * `allow` says so. It is made from the manifest as it is now, so what a tool
 * or another module wrote since the plan was made is kept.
 *
 * `allow-plugins` is changed only where Composer itself would write to it:
 * a list gets one key, and a site with no list gets one. `true` already
 * allows every plugin and stays as it is.
 */
function withPatches(
  source: string,
  wanted: RecordedPatch[],
  allow: boolean
): string {
  const json = parseManifest(source)
  const patches = patchesOf(json)
  for (const patch of wanted) {
    const own = patches[patch.package]?.[patch.description]
    if (own !== undefined && own !== patch.url) {
      throw new Error(
        `composer.json now has a patch for ${patch.package} named "${patch.description}", from ${own}.`
      )
    }
    patches[patch.package] = {
      ...patches[patch.package],
      [patch.description]: patch.url,
    }
  }
  json.extra = { ...extraOf(json), patches }
  if (allow) {
    const config = isRecord(json.config) ? json.config : {}
    const allowed = config['allow-plugins']
    const none = Array.isArray(allowed) && allowed.length === 0
    if (allowed === undefined || none || isRecord(allowed)) {
      json.config = {
        ...config,
        'allow-plugins': {
          ...(isRecord(allowed) ? allowed : {}),
          [PATCHES_PLUGIN]: true,
        },
      }
    }
  }
  return write(source, json)
}

/**
 * The manifest without the patches an add wrote. A patch is taken out only
 * while it is still the one that was written: the same description with
 * another URL is the site's own by now. A key this leaves empty goes too.
 */
function withoutPatches(source: string, leaving: RecordedPatch[]): string {
  const json = parseManifest(source)
  const patches = patchesOf(json)
  let changed = false
  for (const patch of leaving) {
    const forPackage = patches[patch.package]
    if (forPackage?.[patch.description] !== patch.url) continue
    delete forPackage[patch.description]
    if (Object.keys(forPackage).length === 0) delete patches[patch.package]
    changed = true
  }
  if (!changed) return source
  const extra = { ...extraOf(json) }
  if (Object.keys(patches).length === 0) delete extra.patches
  else extra.patches = patches
  if (Object.keys(extra).length === 0) delete json.extra
  else json.extra = extra
  return write(source, json)
}

/** The web root the site names, which is where Drush counts paths from. */
function webRootDir(dir: string, manifest: Manifest | undefined): string {
  const extra = isRecord(manifest?.json.extra) ? manifest.json.extra : {}
  const scaffold = extra['drupal-scaffold']
  const locations = isRecord(scaffold) ? scaffold.locations : undefined
  const webRoot = isRecord(locations) ? locations['web-root'] : undefined
  return resolve(dir, typeof webRoot === 'string' ? webRoot : 'web')
}

/** The directory core keeps its modules in, under the web root. */
const coreModulesDir = (dir: string, manifest: Manifest) =>
  join(webRootDir(dir, manifest), 'core', 'modules')

interface Installed {
  version: string
  /** The names of the packages it requires. */
  requires: string[]
  /** The directory its files are in, when Composer recorded one. */
  path?: string
}

/** Each package Composer has installed, with its version and what it requires. */
async function installedPackages(dir: string): Promise<Map<string, Installed>> {
  const found = new Map<string, Installed>()
  try {
    const installed: unknown = JSON.parse(
      await readFile(join(dir, 'vendor', 'composer', 'installed.json'), 'utf8')
    )
    const packages = isRecord(installed) ? installed.packages : undefined
    for (const entry of Array.isArray(packages) ? packages : []) {
      if (isRecord(entry) && typeof entry.name === 'string') {
        const path = entry['install-path']
        found.set(entry.name, {
          version: String(entry.version),
          requires: Object.keys(isRecord(entry.require) ? entry.require : {}),
          // Composer writes it from the directory the file itself is in.
          ...(typeof path === 'string'
            ? { path: resolve(dir, 'vendor', 'composer', path) }
            : {}),
        })
      }
    }
  } catch {
    // Nothing is installed yet.
  }
  return found
}

/**
 * The modules the site has enabled, each with its path from the web root,
 * as Drush lists them. Undefined when it cannot be asked: no database yet,
 * or the backend is not running.
 */
async function enabledModules(
  ask: Ask
): Promise<Map<string, string> | undefined> {
  const result = await ask('drush', [
    'pm:list',
    '--type=module',
    '--status=enabled',
    '--fields=name,path',
    '--format=json',
  ])
  if (result.code !== 0) return undefined
  try {
    // Drush may print a notice before the document.
    const list: unknown = JSON.parse(
      result.output.slice(result.output.indexOf('{'))
    )
    if (!isRecord(list)) return undefined
    return new Map(
      Object.entries(list).map(([name, row]) => [
        name,
        isRecord(row) && typeof row.path === 'string' ? row.path : '',
      ])
    )
  } catch {
    return undefined
  }
}

/**
 * What uninstalling a module would uninstall: the module and every enabled
 * module that depends on it. Drush says so when it is asked to simulate, and
 * uninstalls nothing. `absent` when the module is not enabled, and undefined
 * when Drush did not answer in a form that can be read.
 */
async function uninstallList(
  ask: Ask,
  name: string
): Promise<string[] | 'absent' | undefined> {
  const result = await ask('drush', ['pm:uninstall', '--simulate', '--', name])
  if (result.code !== 0) {
    return /not installed/.test(result.output) ? 'absent' : undefined
  }
  const listed = /will be uninstalled: *([^\n]+)/.exec(result.output)?.[1]
  const names = listed?.split(',').map((item) => item.trim()) ?? []
  return names.includes(name) ? names : undefined
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
  if (need.core === false) return 'package'
  if (request.registryStatesCore || need.composer) return 'package'
  if (packageOf(need) in manifest.require) return 'package'
  if (!existsSync(coreDir)) return 'unknown'
  return existsSync(join(coreDir, need.name)) ? 'core' : 'package'
}

const list = (names: string[]) =>
  names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`

/** The steps that add the backend modules a Druxt module needs. */
export async function planBackendAdd(
  dir: string,
  request: AddRequest
): Promise<ModuleChange> {
  const change = emptyChange()
  const { needs, ask } = request
  if (needs.length === 0) return change

  // A backend that is run somewhere else may not have its files here. Its
  // lines are printed for whoever is there, so an empty manifest will do.
  const manifest =
    (await readManifest(dir)) ??
    (ask ? undefined : { json: {}, require: {}, patches: {} })
  if (!manifest) {
    change.problems.push(
      `There is no composer.json to add ${needs.map(({ name }) => name).join(', ')} to.`
    )
    return change
  }

  const coreDir = coreModulesDir(dir, manifest)
  const installed = await installedPackages(dir)
  const enabled = ask ? await enabledModules(ask) : undefined
  const record: BackendRecord = { modules: [], patches: [] }
  const toRequire: string[] = []
  const toEnable: string[] = []
  const unsure: string[] = []
  const patches: Patches = structuredClone(manifest.patches)
  let repatch = false

  for (const need of needs) {
    const pkg = packageOf(need)
    let from = origin(need, request, manifest, coreDir)
    if (from === 'unknown') {
      if (ask) {
        change.problems.push(
          `Cannot tell whether ${need.name} is part of core or a package to require: the module registry does not say, and core is not installed in this part to look in. Install the dependencies of the backend, then run this again.`
        )
        continue
      }
      // Nothing here can settle it, so the line is printed and the doubt said.
      unsure.push(need.name)
      from = 'package'
    }
    let required = false
    if (from === 'package') {
      if (pkg in manifest.require) {
        change.notes.push(`${pkg} is already required in composer.json.`)
      } else {
        toRequire.push(
          need.composer?.constraint ? `${pkg}:${need.composer.constraint}` : pkg
        )
        required = true
      }
    }

    // Only a module this run enables is one a later remove may uninstall.
    const wasEnabled = enabled?.has(need.name) === true
    if (wasEnabled) change.notes.push(`${need.name} is already enabled.`)
    else toEnable.push(need.name)
    const enables = enabled !== undefined && !wasEnabled
    if (required || enables) {
      record.modules.push({
        name: need.name,
        ...(from === 'package' ? { package: pkg } : {}),
        enabled: enables,
        required,
      })
    }

    for (const patch of need.patches ?? []) {
      const target = patch.package ?? pkg
      if (!request.patches) {
        change.warnings.push(
          `The patch "${patch.description}" for ${target} was not applied. ${need.label} may not work without it.`
        )
        continue
      }
      if (!patch.url.startsWith('https://')) {
        change.problems.push(
          `The patch "${patch.description}" that ${need.name} needs is at ${patch.url}, and Composer only fetches a patch over https. Pass --no-patches to add the module without it.`
        )
        continue
      }
      const has = installed.get(target)?.version
      const fixed = patch.until ? semver.coerce(patch.until) : null
      const version = has ? semver.coerce(has) : null
      if (fixed && version && semver.gte(version, fixed)) {
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
      // The same name with another URL is a patch the site's owner wrote.
      const own = patches[target]?.[patch.description]
      if (own !== undefined) {
        change.problems.push(
          `composer.json already has a patch for ${target} named "${patch.description}", from ${own}. It is the site's own, and drx add does not replace it. Rename it, or pass --no-patches to add the module without the patch from the registry.`
        )
        continue
      }
      patches[target] = { ...patches[target], [patch.description]: patch.url }
      record.patches.push({
        package: target,
        description: patch.description,
        url: patch.url,
        module: need.name,
      })
      change.notes.push(
        `Patch for ${target}: ${patch.description}${patch.issue ? ` (${patch.issue})` : ''}`
      )
      // A package that is installed has to be patched in place, whether the
      // site requires it itself or another package brought it in. One that
      // is not is patched as it is installed.
      if (installed.has(target)) repatch = true
    }

    for (const step of need.setup ?? []) {
      change.after.push(`${need.label}: ${step.title}`)
      if (step.command) change.after.push(`  ${step.command}`)
      if (step.url) change.after.push(`  ${step.url}`)
    }
  }

  // A patch is written for the plugin that applies it, in the version that
  // keeps a lock file, and only on a site that lets the plugin run.
  const hasPlugin = PATCHES_PLUGIN in manifest.require
  const config = isRecord(manifest.json.config) ? manifest.json.config : {}
  const allowed = config['allow-plugins']
  const first = record.patches[0]
  if (first) {
    const without = 'pass --no-patches to add the module without the patch'
    const plugin = installed.get(PATCHES_PLUGIN)?.version
    const major = plugin ? semver.coerce(plugin)?.major : undefined
    if (major !== undefined && major < PATCHES_PLUGIN_MAJOR) {
      change.problems.push(
        `This site has ${PATCHES_PLUGIN} ${plugin}, and the patch "${first.description}" is written for version ${PATCHES_PLUGIN_MAJOR} of the plugin, which keeps patches in a lock file. Update the plugin to version ${PATCHES_PLUGIN_MAJOR}, or ${without}.`
      )
    }
    if (allowed === false) {
      change.problems.push(
        `composer.json sets allow-plugins to false, which turns every Composer plugin off, and the patch "${first.description}" needs ${PATCHES_PLUGIN}. Allow the plugin there, or ${without}.`
      )
    } else if (isRecord(allowed) && allowed[PATCHES_PLUGIN] === false) {
      change.problems.push(
        `composer.json turns ${PATCHES_PLUGIN} off under allow-plugins, and the patch "${first.description}" needs it. Allow the plugin there, or ${without}.`
      )
    }
  }

  if (change.problems.length > 0) return change
  if (ask && !enabled && toEnable.length > 0) {
    change.warnings.push(
      `The backend could not say which modules are enabled. ${toEnable.join(', ')} will be enabled, and drx remove will leave ${toEnable.length === 1 ? 'it' : 'them'} enabled, since ${toEnable.length === 1 ? 'it' : 'they'} may have been before.`
    )
  }
  if (unsure.length > 0) {
    change.manual.push(
      `The module registry does not say whether ${list(unsure)} is part of core. Leave a module that is out of the composer require line: only the enable line applies to it.`
    )
  }
  // Each step carries what it will have done, so a run that stops part way
  // can still say what it did.
  const composer = (args: string[], done?: BackendRecord) =>
    change.steps.push({
      run: { tool: 'composer', args },
      ...(done ? { record: done } : {}),
    })

  if (record.patches.length > 0) {
    // Allowed before it is required, or Composer stops to ask.
    const allow = !hasPlugin
    const count = record.patches.length
    change.steps.push({
      edit: {
        file: 'composer.json',
        change: (source) => withPatches(source, record.patches, allow),
        summary: `Add ${count} patch${count === 1 ? '' : 'es'} to composer.json`,
      },
      record: { modules: [], patches: record.patches },
    })
    if (!hasPlugin) {
      composer([
        'require',
        '--',
        `${PATCHES_PLUGIN}:${PATCHES_PLUGIN_CONSTRAINT}`,
      ])
    }
    composer(['patches-relock'])
  }
  if (toRequire.length > 0) {
    composer(['require', '--', ...toRequire], {
      modules: record.modules
        .filter((module) => module.required)
        .map((module) => ({ ...module, enabled: false })),
      patches: [],
    })
  }
  if (record.patches.length > 0 && repatch) composer(['patches-repatch'])
  if (toEnable.length > 0) {
    change.steps.push({
      run: { tool: 'drush', args: ['en', '-y', '--', ...toEnable] },
      record: {
        modules: record.modules
          .filter((module) => module.enabled)
          .map((module) => ({ ...module, required: false })),
        patches: [],
      },
    })
  }

  change.record = record
  if (ask && enabled) {
    // Drush enables what a module depends on along with it, and a run that
    // failed may have enabled some of what it was asked to. Either is seen
    // only by asking again. What was required is what the steps taken say.
    change.settle = async (done) => {
      const after = await enabledModules(ask)
      if (!after) return done
      const came = [...after.keys()].filter((name) => !enabled.has(name))
      const modules = record.modules
        .map((module) => ({
          ...module,
          enabled: came.includes(module.name),
          required: done.modules.some(
            (other) => other.name === module.name && other.required
          ),
        }))
        .filter((module) => module.enabled || module.required)
      for (const name of came) {
        if (!modules.some((module) => module.name === name)) {
          modules.push({ name, enabled: true, required: false })
        }
      }
      return { modules, patches: done.patches }
    }
  }
  return change
}

/**
 * The steps that undo what an add did to the part: the modules it enabled,
 * the requirements it added and the patches it wrote, and nothing the site's
 * owner put there.
 *
 * A module is uninstalled only once the site has said that nothing enabled
 * depends on it. Drush uninstalls the dependents of a module along with it
 * and asks first, and with nobody to ask it takes the answer to be yes. So
 * a module with a dependent stays, with its requirement and its patches, and
 * so does one the site cannot be asked about.
 */
export async function planBackendRemove(
  dir: string,
  request: RemoveRequest
): Promise<ModuleChange> {
  const change = emptyChange()
  const { record, ask } = request
  if (!record) return change

  const stays = new Set<string>()
  const dependents = new Map<string, string[]>()
  for (const { name, package: pkg, enabled, required } of record.modules) {
    if (!enabled) continue
    const found = ask ? await uninstallList(ask, name) : undefined
    if (found === 'absent') {
      change.notes.push(`${name} is not enabled, so it is not uninstalled.`)
    } else if (found) {
      dependents.set(name, found)
    } else {
      stays.add(name)
      change.manual.push(
        `The backend could not say what depends on ${name}, so it was left enabled. Once nothing does: drush pm:uninstall ${name}${required && pkg ? `, then composer remove ${pkg}` : ''}`
      )
    }
  }
  // A module goes only when everything that would go with it is going too.
  let going = [...dependents.keys()]
  for (let settled = false; !settled;) {
    settled = true
    for (const name of going) {
      const held = (dependents.get(name) ?? []).filter(
        (other) => !going.includes(other)
      )
      if (held.length === 0) continue
      going = going.filter((other) => other !== name)
      stays.add(name)
      change.notes.push(
        `${name} stays enabled: ${held.join(', ')} depend${held.length === 1 ? 's' : ''} on it.`
      )
      settled = false
      break
    }
  }

  // A requirement goes with its module. One whose module the site had
  // enabled before goes only while another package still brings the module
  // in, or once the module is off: its files must not go from under it.
  const manifest = await readManifest(dir)
  const installed = await installedPackages(dir)
  const removing = record.modules.filter(
    (module) => module.required && module.package && !stays.has(module.name)
  )
  const packages = new Set(removing.map((module) => module.package as string))
  const heldByAnother = (pkg: string) =>
    [...installed].some(
      ([name, { requires }]) => !packages.has(name) && requires.includes(pkg)
    )
  let listed: Map<string, string> | undefined | null = null
  const enabledNow = async () => {
    if (listed === null) listed = ask ? await enabledModules(ask) : undefined
    return listed
  }
  const unowned = removing.filter(
    (module) => !module.enabled && !heldByAnother(module.package as string)
  )
  for (const { name, package: pkg } of unowned) {
    const enabled = await enabledNow()
    if (enabled && !enabled.has(name)) continue
    stays.add(name)
    packages.delete(pkg as string)
    change.notes.push(
      `${pkg} stays required: ${name} was enabled before drx add, and nothing else brings it in.`
    )
  }
  const kept = [...packages].filter(heldByAnother)
  let free = [...packages].filter((pkg) => !kept.includes(pkg))

  // A package whose files are about to go must hold no module that is still
  // enabled: one the user enabled since, or one that came up with another.
  const holding = new Set<string>()
  const root = webRootDir(dir, manifest)
  for (const pkg of free) {
    const base = installed.get(pkg)?.path
    const enabled = base ? await enabledNow() : undefined
    if (!base || !enabled) continue
    const held = [...enabled]
      .filter(([name, path]) => {
        const at = resolve(root, path)
        return (
          !going.includes(name) && (at === base || at.startsWith(base + sep))
        )
      })
      .map(([name]) => name)
    if (held.length === 0) continue
    holding.add(pkg)
    change.notes.push(
      `${pkg} stays required: ${held.join(', ')} ${held.length === 1 ? 'is' : 'are'} enabled, and ${held.length === 1 ? 'its' : 'their'} files are in that package.`
    )
  }
  free = free.filter((pkg) => !holding.has(pkg))
  /** The modules whose requirement stays though they are uninstalled. */
  const required = record.modules.filter(
    (module) =>
      !stays.has(module.name) && module.package && holding.has(module.package)
  )
  const keeps = (name: string) =>
    stays.has(name) || required.some((module) => module.name === name)

  if (going.length > 0) {
    // -y answers a question that has been asked above, of each module.
    change.steps.push({
      run: { tool: 'drush', args: ['pmu', '-y', '--', ...going] },
    })
  }

  // A patch goes with the requirement of the module it was written for. A
  // record that does not say which that was keeps every patch while any
  // module stays.
  const leaving = record.patches.filter((patch) =>
    patch.module ? !keeps(patch.module) : stays.size + required.length === 0
  )
  const unpatched = new Set<string>()
  if (manifest) {
    const patches: Patches = structuredClone(manifest.patches)
    for (const patch of leaving) {
      const forPackage = patches[patch.package]
      if (forPackage?.[patch.description] !== patch.url) continue
      delete forPackage[patch.description]
      if (Object.keys(forPackage).length === 0) delete patches[patch.package]
      unpatched.add(patch.package)
    }
    if (unpatched.size > 0) {
      const count = leaving.filter((patch) =>
        unpatched.has(patch.package)
      ).length
      change.steps.push({
        edit: {
          file: 'composer.json',
          change: (source) => withoutPatches(source, leaving),
          summary: `Remove ${count} patch${count === 1 ? '' : 'es'} from composer.json`,
        },
      })
    }
  }

  const composer = (...args: string[]) =>
    change.steps.push({ run: { tool: 'composer', args } })
  // Composer's remove fails on a package another one still requires, after
  // it has taken the requirement out. So that one is only taken out of the
  // manifest. The rest are removed without letting Composer update what
  // they depended on, which is every package of core.
  if (kept.length > 0) composer('remove', '--no-update', '--', ...kept)
  if (free.length > 0) {
    composer('remove', '--no-update-with-dependencies', '--', ...free)
  } else if (kept.length > 0) {
    composer('update', '--lock')
  }
  if (unpatched.size > 0) {
    composer('patches-relock')
    // A package that stays installed still has the patch applied to it.
    const still = [...unpatched].filter(
      (pkg) => installed.has(pkg) && !free.includes(pkg)
    )
    if (still.length > 0) composer('reinstall', '--', ...still)
  }

  const left: BackendRecord = {
    modules: [
      ...record.modules.filter(({ name }) => stays.has(name)),
      // Uninstalled by the steps above, so only the requirement is left.
      ...required.map((module) => ({ ...module, enabled: false })),
    ],
    patches: record.patches.filter((patch) => !leaving.includes(patch)),
  }
  if (left.modules.length + left.patches.length > 0) change.record = left
  return change
}
