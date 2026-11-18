import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { defineCommand, type ArgsDef } from 'citty'
import { assertKnownOptions } from '../args.js'
import {
  checkCommands,
  describeAlternatives,
  type CommandCheck,
} from '../commands-on-path.js'
import type { CliContext } from '../context.js'
import { writeBackendUrl } from '../engines/backend-url.js'
import {
  assertBaseUrl,
  chooseEngine,
  missingCommandsWarning,
  stepLines,
  type EngineChoice,
} from '../engines/choose.js'
import { removeEngineFiles } from '../engines/files.js'
import { DrxError } from '../errors.js'
import {
  assertLayoutAvailable,
  AVAILABLE_LAYOUTS,
  isLayout,
  LAYOUTS,
  type Layout,
} from '../layouts.js'
import { createOutput, type Output } from '../output.js'
import { writeProjectConfig, type ProjectConfig } from '../project.js'
import { shellQuote } from '../repeat.js'
import type { StarterEntry } from '../registry/entry.js'
import {
  defaultStarter,
  openRegistry,
  type Registry,
} from '../registry/registry.js'
import {
  assertSourceAvailable,
  DEFAULT_SOURCE,
  resolveSource,
} from '../sources.js'
import { loadUserConfig, resolveRegistryUrl } from '../user-config.js'

/** A starter not maintained for this long gets a warning. */
const STALE_AFTER_DAYS = 365

const args = {
  dir: {
    type: 'positional',
    required: false,
    description: 'The directory to create the site in',
  },
  starter: {
    type: 'string',
    valueHint: 'name',
    description:
      'The starter to create the site from (default: the default of the registry)',
  },
  layout: {
    type: 'enum',
    options: [...LAYOUTS],
    description: `How the parts of the site are put together (available: ${AVAILABLE_LAYOUTS.join(', ')})`,
  },
  registry: {
    type: 'string',
    valueHint: 'url',
    description:
      'A starter registry: a URL, or a name from the user configuration',
  },
  source: {
    type: 'string',
    valueHint: 'name',
    description: `Where the Druxt packages come from (default: ${DEFAULT_SOURCE})`,
  },
  engine: {
    type: 'string',
    valueHint: 'name',
    description:
      'How the backend runs: an engine of the starter, or none for a backend that exists already',
  },
  database: {
    type: 'string',
    valueHint: 'name',
    description: 'The database, where the engine offers a choice',
  },
  'base-url': {
    type: 'string',
    valueHint: 'url',
    description: 'With --engine none: the URL of the backend',
  },
  'keep-engines': {
    type: 'boolean',
    description: 'Keep the files of the engines that were not chosen',
  },
  setup: {
    type: 'boolean',
    description:
      'Run the steps of the engine after creating the site (not available yet)',
  },
  install: {
    type: 'boolean',
    description: 'Install the dependencies of the site after creating it',
    negativeDescription: 'Do not install the dependencies of the site',
  },
  force: {
    type: 'boolean',
    description: 'Write into a directory that exists and is not empty',
  },
  yes: {
    type: 'boolean',
    alias: 'y',
    description: 'Accept the default for everything not given, and ask nothing',
  },
  json: {
    type: 'boolean',
    description: 'Print the result as JSON on stdout',
  },
} satisfies ArgsDef

interface InitOptions {
  dir?: string
  starter?: string
  layout?: Layout
  registry?: string
  source?: string
  engine?: string
  database?: string
  baseUrl?: string
  keepEngines: boolean
  setup: boolean
  install?: boolean
  force: boolean
  yes: boolean
}

/** A string option's value, or an error when it was given with none. */
function valueOf(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DrxError('usage', `--${name} needs a value.`)
  }
  return value
}

async function chooseStarter(
  registry: Registry,
  options: InitOptions,
  context: CliContext,
  canAsk: boolean
): Promise<StarterEntry> {
  if (options.starter) return registry.entry(options.starter)

  const names = await registry.names()
  if (canAsk && names.length > 1) {
    const chosen = await context.prompter.select({
      message: 'Which starter?',
      choices: names.map((name) => ({ value: name, label: name })),
    })
    return registry.entry(chosen)
  }

  const entry = await defaultStarter(registry)
  if (!entry) {
    throw new DrxError(
      'unknown-starter',
      `The registry marks no starter as the default. Pass --starter with one of: ${names.join(', ')}.`
    )
  }
  return entry
}

async function chooseLayout(
  entry: StarterEntry,
  options: InitOptions,
  context: CliContext,
  canAsk: boolean
): Promise<Layout> {
  const own = entry.druxt.layout
  let layout = options.layout
  if (!layout && canAsk) {
    layout = await context.prompter.select({
      message: 'Which layout?',
      choices: LAYOUTS.map((value) => ({
        value,
        label: value,
        ...(AVAILABLE_LAYOUTS.includes(value)
          ? {}
          : { hint: 'not available yet' }),
      })),
      initial: own,
    })
  }
  layout ??= own
  assertLayoutAvailable(layout)
  if (layout !== own) {
    throw new DrxError(
      'not-available',
      `The ${entry.name} starter has the ${own} layout and cannot be created as ${layout}.`
    )
  }
  return layout
}

/** The directory to create, checked against what is already there. */
function targetDirectory(cwd: string, dir: string, force: boolean): string {
  const target = resolve(cwd, dir)
  if (!existsSync(target)) return target
  if (!statSync(target).isDirectory()) {
    throw new DrxError(
      'directory-not-empty',
      `${target} is a file, not a directory.`
    )
  }
  if (!force && readdirSync(target).length > 0) {
    throw new DrxError(
      'directory-not-empty',
      `${target} exists and is not empty. Choose another directory, or pass --force to write into it.`
    )
  }
  return target
}

/** True when `running` is the version `needed` names, or one inside it. */
function nodeSatisfies(running: string, needed: string): boolean {
  const version = needed.replace(/^v/, '')
  return running === version || running.startsWith(`${version}.`)
}

function warnAboutStarter(
  entry: StarterEntry,
  engine: EngineChoice | undefined,
  target: string,
  context: CliContext,
  output: Output
): CommandCheck | null {
  const { requires, maintained, parts } = entry.druxt
  if (!nodeSatisfies(context.nodeVersion, requires.node)) {
    output.warn(
      `The ${entry.name} starter needs Node ${requires.node} and this is Node ${context.nodeVersion}. Switch before you install or run the site.`
    )
  }
  const age = context.now().getTime() - new Date(maintained).getTime()
  if (age > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000) {
    output.warn(
      `The ${entry.name} starter was last maintained on ${maintained} and may no longer work.`
    )
  }
  for (const part of parts) {
    if (!existsSync(join(target, part.path))) {
      output.warn(
        `The starter has no ${part.path}/ directory, which its registry entry names as the ${part.role} part.`
      )
    }
  }

  if (engine) {
    // The chosen engine's commands are the ones that matter. An engine with
    // none, such as a backend that exists already, has nothing to check.
    if (engine.commands.length === 0) return null
    const check = checkCommands([engine.commands], context.findCommand)
    if (!check.satisfied) {
      output.warn(
        missingCommandsWarning(engine.name, engine.commands, check.missing)
      )
    }
    return check
  }

  if (!requires.commands) return null
  const commands = checkCommands(requires.commands, context.findCommand)
  if (!commands.satisfied) {
    const advice =
      commands.alternatives.length > 1
        ? 'Install the commands of one alternative'
        : 'Install what is missing'
    output.warn(
      `The ${entry.name} starter needs ${describeAlternatives(commands.alternatives)}. Not found on PATH: ${commands.missing.join(', ')}. ${advice} before you set up the site.`
    )
  }
  return commands
}

async function runInit(
  options: InitOptions,
  context: CliContext,
  output: Output
): Promise<void> {
  const canAsk = context.interactive && !options.yes
  if (!options.dir && !canAsk && !options.yes) {
    throw new DrxError(
      'usage',
      'No directory was given and there is no terminal to ask on. Pass a directory, as in "drx init my-site", or --yes to use the default of the starter.'
    )
  }

  if (options.setup) {
    throw new DrxError(
      'not-available',
      '--setup is not available yet. init prints the steps for you to run.'
    )
  }
  if (options.baseUrl) assertBaseUrl(options.baseUrl)

  // Everything that can fail without the network is checked before it is used.
  const userConfig = await loadUserConfig(context.env)
  const source = resolveSource(options.source ?? DEFAULT_SOURCE, userConfig)
  assertSourceAvailable(source)
  if (options.layout) assertLayoutAvailable(options.layout)
  const registryUrl = options.registry
    ? resolveRegistryUrl(options.registry, userConfig)
    : undefined

  const registry = await openRegistry({
    ...(registryUrl ? { url: registryUrl } : {}),
    defaultUrl: context.defaultRegistry,
    bundledDir: context.bundledRegistryDir,
    fetch: context.fetch,
    ...(context.env.GIGET_AUTH ? { auth: context.env.GIGET_AUTH } : {}),
  })
  if (registry.origin === 'bundled') {
    output.note(`${registry.fallbackReason}`)
    output.note('Reading starters from the copy bundled with this version.')
  } else {
    output.note(`Reading starters from ${registry.location}.`)
  }

  const entry = await chooseStarter(registry, options, context, canAsk)
  const layout = await chooseLayout(entry, options, context, canAsk)
  const engine = await chooseEngine(entry, options, context, canAsk)

  const defaultDir = entry.defaultDir ?? entry.name
  const dir =
    options.dir ??
    (canAsk
      ? await context.prompter.text({
          message: 'Where should the site be created?',
          initial: defaultDir,
        })
      : defaultDir)
  const target = targetDirectory(context.cwd, dir, options.force)
  // Looked at before the download, which fills the directory.
  const held = existsSync(target) && readdirSync(target).length > 0

  const install =
    options.install ??
    (canAsk
      ? await context.prompter.confirm({
          message: 'Install its dependencies now?',
          initial: false,
        })
      : false)

  output.note(`Fetching the ${entry.name} starter from ${entry.tar}.`)
  try {
    await context.download(`starter:${entry.name}`, {
      // The entry is already read and checked, so giget is handed it as it
      // is and looks nothing up.
      providers: {
        starter: () => ({
          name: entry.name,
          // giget keeps the archive under the name and the version, and
          // unpacks the kept one when a fetch fails. The version is the
          // address, so the kept archive is only ever this entry's own.
          version: createHash('sha256').update(entry.tar).digest('hex'),
          tar: entry.tar,
          ...(entry.subdir ? { subdir: entry.subdir } : {}),
          ...(entry.headers ? { headers: entry.headers } : {}),
        }),
      },
      registry: false,
      dir: target,
      // The directory was checked above, with --force taken into account.
      force: true,
      silent: true,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new DrxError(
      'download',
      `Could not fetch the ${entry.name} starter: ${detail}`
    )
  }

  let removed: string[] = []
  if (engine && !options.keepEngines) {
    // In a directory that held files, a path of another engine may be the
    // user's own, and --force was a yes to writing, not to deleting.
    const paths = await removeEngineFiles(
      target,
      engine.remove,
      engine.keep,
      held
    )
    if (held && paths.length > 0) {
      output.warn(
        `${target} was not empty, so the files of the engines not chosen were left in place: ${paths.join(', ')}. --force writes the files of the starter and deletes nothing.`
      )
    } else if (paths.length > 0) {
      removed = paths
      output.note(
        `Removed the files of the engines not chosen: ${removed.join(', ')}.`
      )
    }
  }
  if (engine?.writeUrl) {
    const where = entry.druxt.backendUrl
    if (where) {
      await writeBackendUrl(target, where, engine.writeUrl)
      output.note(
        `Wrote ${where.variable}=${engine.writeUrl} to ${where.file}.`
      )
    } else if (engine.baseUrl) {
      output.warn(
        `The ${entry.name} starter does not say where it reads its backend URL from. Point it at ${engine.baseUrl} yourself.`
      )
    }
  }

  const config: ProjectConfig = {
    layout,
    line: entry.druxt.line,
    starter: entry.name,
    source: source.name,
    // The choice is recorded on every backend part, for the commands that
    // will run tools in it.
    parts: entry.druxt.parts.map((part) =>
      engine && part.role === 'backend'
        ? {
            ...part,
            engine: engine.name,
            ...(engine.database ? { database: engine.database } : {}),
            ...(engine.baseUrl ? { baseUrl: engine.baseUrl } : {}),
          }
        : part
    ),
  }
  await writeProjectConfig(target, config)
  const commands = warnAboutStarter(entry, engine, target, context, output)

  if (install) {
    output.note('Installing dependencies.')
    try {
      await context.install(target)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new DrxError(
        'install',
        `The site was created in ${target}, but installing its dependencies failed: ${detail}`
      )
    }
  }

  const fromCwd = relative(context.cwd, target)
  const inside = fromCwd !== '' && !fromCwd.startsWith('..')
  // A step the install ran is not left to run: running a setup twice can
  // undo the first.
  const ran = install ? entry.druxt.install : undefined
  const next = [
    `cd ${shellQuote(inside && !isAbsolute(fromCwd) ? fromCwd : target)}`,
    ...stepLines(
      (engine ? engine.steps : (entry.druxt.steps ?? [])).filter(
        (step) => !(typeof step === 'string' && ran?.runs?.includes(step))
      )
    ),
  ]
  const { requires } = entry.druxt
  const needs = engine ? [engine.label] : requires.tools
  const notes = [...(engine?.notes ?? []), ...(ran?.notes ?? [])]

  output.result(
    {
      ok: true,
      directory: target,
      registry: { origin: registry.origin, location: registry.location },
      ...config,
      installed: install,
      requires,
      engine: engine?.name ?? null,
      database: engine?.database ?? null,
      baseUrl: engine?.baseUrl ?? null,
      removed,
      commands,
      next,
      notes,
    },
    [
      `Created a Druxt site in ${target} from the ${entry.name} starter.`,
      '',
      'It needs:',
      `  Node ${requires.node}`,
      ...needs.map((tool) => `  ${tool}`),
      '',
      'Next:',
      ...next.map((step) => `  ${step}`),
      ...(notes.length > 0
        ? ['', 'Note:', ...notes.map((note) => `  ${note}`)]
        : []),
    ].join('\n')
  )
}

export function initCommand(context: CliContext) {
  return defineCommand({
    meta: {
      name: 'init',
      description: 'Create a Druxt site from a starter',
    },
    args,
    async run({ args: parsed, rawArgs }) {
      assertKnownOptions(rawArgs, args, 'init')
      const options: InitOptions = {
        force: parsed.force === true,
        yes: parsed.yes === true,
        keepEngines: parsed['keep-engines'] === true,
        setup: parsed.setup === true,
      }
      const engine = valueOf('engine', parsed.engine)
      const database = valueOf('database', parsed.database)
      const baseUrl = valueOf('base-url', parsed['base-url'])
      if (engine) options.engine = engine
      if (database) options.database = database
      if (baseUrl) options.baseUrl = baseUrl
      const dir = valueOf('dir', parsed.dir)
      const starter = valueOf('starter', parsed.starter)
      const registry = valueOf('registry', parsed.registry)
      const source = valueOf('source', parsed.source)
      if (dir) options.dir = dir
      if (starter) options.starter = starter
      if (registry) options.registry = registry
      if (source) options.source = source
      if (isLayout(parsed.layout)) options.layout = parsed.layout
      if (typeof parsed.install === 'boolean') options.install = parsed.install

      await runInit(
        options,
        context,
        createOutput(context, parsed.json === true)
      )
    },
  })
}
