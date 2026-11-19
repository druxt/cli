import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { assertKnownOptions } from '../args.js'
import type { CliContext } from '../context.js'
import { DrxError } from '../errors.js'
import type { ModuleEntry } from '../modules/entry.js'
import {
  moduleProject,
  type ModuleInPart,
  type ModuleProject,
} from '../modules/project.js'
import {
  describeAge,
  loadModules,
  type LoadedModules,
} from '../modules/registry.js'
import { columns, createOutput, type Output } from '../output.js'
import { repeatCommand } from '../repeat.js'
import { loadUserConfig, resolveModuleRegistryUrl } from '../user-config.js'

export const registryArgs = {
  'module-registry': {
    type: 'string',
    valueHint: 'url',
    description:
      'A module registry: a URL, or a name from the user configuration',
  },
  refresh: {
    type: 'boolean',
    description: 'Read the registry again even when the cached copy is fresh',
  },
  json: {
    type: 'boolean',
    description: 'Print the result as JSON on stdout',
  },
} satisfies ArgsDef

const filterArgs = {
  all: {
    type: 'boolean',
    description: 'Include archived modules',
  },
  type: {
    type: 'string',
    valueHint: 'type',
    description: 'Only modules of this type, such as official or contrib',
  },
  category: {
    type: 'string',
    valueHint: 'category',
    description: 'Only modules in this category',
  },
} satisfies ArgsDef

type Parsed = Record<string, unknown>

/** A string option's value, or an error when it was given with none. */
function valueOf(parsed: Parsed, name: string): string | undefined {
  const value = parsed[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DrxError('usage', `--${name} needs a value.`)
  }
  return value
}

/** Loads the registry the flags name and says on stderr where it came from. */
export async function openModules(
  context: CliContext,
  parsed: Parsed,
  output: Output
): Promise<LoadedModules> {
  const named = valueOf(parsed, 'module-registry')
  const url = named
    ? resolveModuleRegistryUrl(named, await loadUserConfig(context.env))
    : context.defaultModuleRegistry

  const loaded = await loadModules({
    url,
    cacheDir: context.cacheDir,
    now: context.now,
    fetch: context.fetch,
    refresh: parsed.refresh === true,
    // The token goes to a registry the user named, never to the public one.
    ...(named && context.env.GIGET_AUTH
      ? { auth: context.env.GIGET_AUTH }
      : {}),
  })

  const age = describeAge(loaded.ageMs)
  if (loaded.reason) {
    output.note(loaded.reason)
    output.note(`Using the copy of the registry read ${age} ago.`)
  } else if (loaded.origin === 'cache') {
    output.note(`Modules from ${loaded.url}, read ${age} ago.`)
  } else {
    output.note(`Modules from ${loaded.url}.`)
  }
  return loaded
}

/** Says on stderr which Druxt the modules are compared with. */
function noteProject(project: ModuleProject, output: Output): void {
  for (const part of project.parts) {
    const druxt = part.druxt
    const has = !druxt
      ? 'has no druxt'
      : druxt.installed
        ? `has ${druxt.name} ${druxt.installed} installed`
        : `asks for ${druxt.name} ${druxt.range} and has none installed`
    output.note(`Project ${project.root}: ${part.path}/ ${has}.`)
  }
}

function registryReport(loaded: LoadedModules) {
  const { url, origin, fetchedAt, ageMs, reason } = loaded
  return { url, origin, fetchedAt, ageMs, ...(reason ? { reason } : {}) }
}

function projectReport(project: ModuleProject | undefined) {
  return project ? { root: project.root, parts: project.parts } : null
}

function rowReport(module: ModuleEntry) {
  return {
    name: module.name,
    npm: module.npm ?? null,
    type: module.type,
    status: module.status,
    category: module.category,
    archived: module.archived,
    description: module.description,
    druxt: module.druxt ?? null,
  }
}

const status = (module: ModuleEntry) =>
  module.archived ? `${module.status} (archived)` : module.status

const YES_NO = { compatible: 'yes', incompatible: 'no', unknown: 'unknown' }

/** One cell for all parts: the bare value for one part, labelled for more. */
function acrossParts(
  states: ModuleInPart[],
  value: (state: ModuleInPart) => string
): string {
  return states.length === 1
    ? value(states[0] as ModuleInPart)
    : states.map((state) => `${state.path}: ${value(state)}`).join(', ')
}

function installedCell(module: ModuleEntry, state: ModuleInPart): string {
  if (!module.npm) return '-'
  return state.installed ?? (state.declared ? 'declared' : 'no')
}

/** Prints modules as a table, or as JSON, with their state in a project. */
async function printModules(
  modules: ModuleEntry[],
  loaded: LoadedModules,
  project: ModuleProject | undefined,
  output: Output
): Promise<void> {
  const sorted = [...modules].sort((a, b) => a.name.localeCompare(b.name))
  const states = new Map<ModuleEntry, ModuleInPart[]>()
  if (project) {
    for (const module of sorted) states.set(module, await project.state(module))
  }

  const header = ['Name', 'Package', 'Type', 'Status', 'Druxt']
  if (project) header.push('Installed', 'Compatible')
  const rows = sorted.map((module) => {
    const row = [
      module.name,
      module.npm ?? '-',
      module.type,
      status(module),
      module.druxt ?? 'not stated',
    ]
    const inParts = states.get(module)
    if (inParts) {
      row.push(
        acrossParts(inParts, (state) => installedCell(module, state)),
        acrossParts(inParts, (state) => YES_NO[state.compatibility])
      )
    }
    return row
  })

  output.result(
    {
      registry: registryReport(loaded),
      project: projectReport(project),
      modules: sorted.map((module) => ({
        ...rowReport(module),
        ...(project ? { parts: states.get(module) } : {}),
      })),
    },
    rows.length === 0
      ? 'No modules match.'
      : columns([header, ...rows]).join('\n')
  )
}

/** Applies `--all`, `--type` and `--category`. */
function filtered(modules: ModuleEntry[], parsed: Parsed): ModuleEntry[] {
  const type = valueOf(parsed, 'type')?.toLowerCase()
  const category = valueOf(parsed, 'category')?.toLowerCase()
  return modules.filter(
    (module) =>
      (parsed.all === true || !module.archived) &&
      (!type || module.type.toLowerCase() === type) &&
      (!category || module.category.toLowerCase() === category)
  )
}

function listCommand(context: CliContext) {
  const args = { ...filterArgs, ...registryArgs } satisfies ArgsDef
  return defineCommand({
    meta: {
      name: 'list',
      description: 'List the modules in the registry',
    },
    args,
    async run({ args: parsed, rawArgs }) {
      assertKnownOptions(rawArgs, args, 'module list')
      const output = createOutput(context, parsed.json === true)
      output.header()
      const loaded = await openModules(context, parsed, output)
      const project = await moduleProject(context.cwd)
      if (project) noteProject(project, output)
      await printModules(
        filtered(loaded.modules, parsed),
        loaded,
        project,
        output
      )
    },
  })
}

function searchCommand(context: CliContext) {
  const args = {
    text: {
      type: 'positional',
      required: false,
      description: 'Text to find in a name, a package name or a description',
    },
    ...filterArgs,
    ...registryArgs,
  } satisfies ArgsDef
  return defineCommand({
    meta: {
      name: 'search',
      description: 'Search the modules in the registry',
    },
    args,
    async run({ args: parsed, rawArgs }) {
      assertKnownOptions(rawArgs, args, 'module search')
      const text = String(parsed.text ?? '')
        .trim()
        .toLowerCase()
      if (!text) {
        throw new DrxError(
          'usage',
          'Give the text to search for, as in "drx module search menu".'
        )
      }
      const output = createOutput(context, parsed.json === true)
      output.header()
      const loaded = await openModules(context, parsed, output)
      const project = await moduleProject(context.cwd)
      if (project) noteProject(project, output)
      const matches = filtered(loaded.modules, parsed).filter((module) =>
        [module.name, module.npm ?? '', module.description].some((field) =>
          field.toLowerCase().includes(text)
        )
      )
      await printModules(matches, loaded, project, output)
    },
  })
}

/** The number of single-character edits between two strings. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

/** Up to three registry names near a name that matched nothing. */
function closestNames(modules: ModuleEntry[], wanted: string): string[] {
  const limit = Math.max(2, Math.floor(wanted.length / 3))
  return modules
    .map((module) => ({
      name: module.name,
      distance: Math.min(
        ...[module.name, module.npm ?? module.name].map((candidate) =>
          candidate.toLowerCase().includes(wanted)
            ? 0
            : editDistance(wanted, candidate.toLowerCase())
        )
      ),
    }))
    .filter(({ distance }) => distance <= limit)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(({ name }) => name)
}

export function findModule(
  modules: ModuleEntry[],
  wanted: string
): ModuleEntry {
  const name = wanted.toLowerCase()
  const found = modules.find(
    (module) =>
      module.name.toLowerCase() === name || module.npm?.toLowerCase() === name
  )
  if (found) return found
  const closest = closestNames(modules, name)
  throw new DrxError(
    'unknown-module',
    closest.length > 0
      ? `There is no module named "${wanted}". Closest: ${closest.join(', ')}.`
      : `There is no module named "${wanted}". Run "drx module list --all" to see every name.`
  )
}

/** A link to the module's source. The registry names a GitHub repository. */
function repositoryUrl(module: ModuleEntry): string {
  const base = /^https?:\/\//.test(module.repo)
    ? module.repo
    : `https://github.com/${module.repo}`
  return module.path ? `${base}/tree/HEAD/${module.path}` : base
}

/**
 * Whether each backend module a module needs is part of core: true, false,
 * or null when the registry does not say. A registry that marks any module as
 * core is taken to mark them all, so in one that does, a module with no mark
 * is not core.
 */
function backendReport(module: ModuleEntry, registry: ModuleEntry[]) {
  const marked = registry.some((entry) =>
    entry.backend.some((needed) => needed.core)
  )
  return module.backend.map((needed) => ({
    ...needed,
    core: needed.core ?? (marked ? false : null),
  }))
}

function infoText(
  module: ModuleEntry,
  backend: ReturnType<typeof backendReport>,
  project: ModuleProject | undefined,
  states: ModuleInPart[],
  output: Output
): string {
  const lines = [module.name]
  if (module.description) lines.push(module.description)
  lines.push(
    '',
    ...columns(
      [
        ['Package', module.npm ?? 'not published'],
        ['Type', module.type],
        ['Status', status(module)],
        ['Category', module.category],
        ['Druxt', module.druxt ?? 'not stated'],
        ['Repository', repositoryUrl(module)],
        ...(module.website ? [['Website', module.website]] : []),
      ],
      ''
    ),
    ''
  )

  if (backend.length === 0) {
    lines.push('Backend modules it needs: none listed.')
  } else {
    lines.push(
      'Backend modules it needs:',
      ...columns(
        backend.map((needed) => [
          needed.kind,
          needed.name,
          needed.label,
          [needed.core ? '(core)' : '', needed.url ?? ''].join(' ').trim(),
        ]),
        '  '
      )
    )
    if (backend.some((needed) => needed.core === null)) {
      lines.push('The registry does not say which of these are part of core.')
    }
  }

  for (const [index, state] of states.entries()) {
    const druxt = project?.parts[index]?.druxt
    const asked = state.declared ? ` (asked for as ${state.declared})` : ''
    lines.push(
      '',
      // Every part a module is installed in is a frontend part.
      output.out.role('frontend', `In ${state.path}/:`),
      ...columns(
        [
          ['Installed', `${state.installed ?? 'no'}${asked}`],
          [
            'Druxt',
            !druxt
              ? 'none'
              : druxt.installed
                ? `${druxt.installed} installed`
                : `${druxt.range} asked for, none installed`,
          ],
          ['Compatible', YES_NO[state.compatibility]],
        ],
        '  '
      )
    )
  }
  return lines.join('\n')
}

function infoCommand(context: CliContext) {
  const args = {
    name: {
      type: 'positional',
      required: false,
      description: 'The name of a module, or of its package',
    },
    ...registryArgs,
  } satisfies ArgsDef
  return defineCommand({
    meta: {
      name: 'info',
      description: 'Details of one module: its package, range, needs and links',
    },
    args,
    async run({ args: parsed, rawArgs }) {
      assertKnownOptions(rawArgs, args, 'module info')
      const wanted = String(parsed.name ?? '').trim()
      if (!wanted) {
        throw new DrxError(
          'usage',
          'Give the name of a module, as in "drx module info blocks".'
        )
      }
      const output = createOutput(context, parsed.json === true)
      output.header()
      const loaded = await openModules(context, parsed, output)
      await showModule(
        findModule(loaded.modules, wanted),
        loaded,
        context,
        output
      )
    },
  })
}

/** Prints one module in full, with its state in the project around `cwd`. */
async function showModule(
  module: ModuleEntry,
  loaded: LoadedModules,
  context: CliContext,
  output: Output
): Promise<void> {
  const project = await moduleProject(context.cwd)
  const states = project ? await project.state(module) : []
  const backend = backendReport(module, loaded.modules)
  output.result(
    {
      registry: registryReport(loaded),
      project: projectReport(project),
      module: {
        ...rowReport(module),
        repository: repositoryUrl(module),
        ...(module.website ? { website: module.website } : {}),
        backend,
        ...(project ? { parts: states } : {}),
      },
    },
    infoText(module, backend, project, states, output)
  )
}

/**
 * `drx module` with no command, in a terminal: a list of the modules to
 * narrow by typing, then the one picked shown as `drx module info` shows it.
 */
async function pickModule(
  context: CliContext,
  parsed: Parsed,
  output: Output
): Promise<void> {
  output.header()
  const loaded = await openModules(context, parsed, output)
  const listed = loaded.modules
    .filter((module) => !module.archived)
    .sort((a, b) => a.name.localeCompare(b.name))
  const name = await context.prompter.search({
    message: 'Which module?',
    choices: listed.map((module) => ({
      value: module.name,
      label: module.name,
      hint: `${module.npm ?? 'not published'}. ${module.description}`.trim(),
    })),
  })
  await showModule(findModule(listed, name), loaded, context, output)
  output.line()
  output.line(`Repeat this with: ${repeatCommand(['module', 'info', name])}`)
}

/**
 * A command that changes a project. The name is taken now, so scripts and
 * documentation can rely on it, and it fails until it is built.
 */
function notAvailable(name: string, description: string) {
  return defineCommand({
    meta: { name, description: `${description} (not available yet)` },
    run() {
      throw new DrxError(
        'not-available',
        `drx module ${name} is not available yet. Run "drx module --help" for the commands this version has.`
      )
    },
  })
}

/**
 * The `module` group. The commands that change a project are handed in, as
 * they are the top-level `add` and `remove` under a second name.
 */
export function moduleCommand(
  context: CliContext,
  changing: Record<string, CommandDef>
) {
  const subCommands = {
    list: listCommand(context),
    search: searchCommand(context),
    info: infoCommand(context),
    ...changing,
    configure: notAvailable('configure', 'Set the options of a module'),
  }
  return defineCommand({
    meta: {
      name: 'module',
      description: 'List, search and view the modules in the Druxt registry',
    },
    args: registryArgs,
    subCommands,
    // citty runs this after a subcommand as well as in place of one.
    async run({ args: parsed, rawArgs }) {
      if (rawArgs.some((argument) => argument in subCommands)) return
      if (!context.interactive || parsed.json === true) {
        throw new DrxError(
          'usage',
          'No command specified. Run "drx module --help" for the module commands.'
        )
      }
      assertKnownOptions(rawArgs, registryArgs, 'module')
      await pickModule(context, parsed, createOutput(context, false))
    },
  })
}
