import { checkCommands, describeAlternatives } from '../commands-on-path.js'
import type { Choice, CliContext } from '../context.js'
import { DrxError } from '../errors.js'
import {
  EXISTING_BACKEND,
  type EngineStep,
  type StarterEngine,
  type StarterEntry,
} from '../registry/entry.js'
import { isHttpUrl } from '../validate.js'
import { trimEndSlashes } from '../slashes.js'
import type { EngineProject } from './project-name.js'

/** What the flags say about the engine. Each is undefined when not given. */
export interface EngineOptions {
  engine?: string
  database?: string
  baseUrl?: string
}

/** The engine a site is created with, and what follows from the choice. */
export interface EngineChoice {
  name: string
  /** The engine's name as the user reads it. */
  label: string
  /** What the site needs for this engine, as a phrase. */
  needs: string
  /** The commands the engine needs on PATH. */
  commands: string[]
  database?: string
  /** The URL of a backend that exists already. Recorded in the project. */
  baseUrl?: string
  /** The URL to write where the starter reads its backend URL from. */
  writeUrl?: string
  /** The project name the starter ships with, to be replaced by the site's. */
  project?: EngineProject
  /** The site's own project name, once the directory is known. */
  projectName?: string
  steps: EngineStep[]
  notes: string[]
  /** The paths the chosen engine needs. */
  keep: string[]
  /** The paths of the engines that were not chosen. */
  remove: string[]
}

/** Fails unless the value of `--base-url` is a URL a site can fetch from. */
export function assertBaseUrl(value: string): void {
  if (!isHttpUrl(value)) {
    throw new DrxError(
      'usage',
      `--base-url must be an http or https URL: "${value}".`
    )
  }
}

const missingFrom = (engine: StarterEngine, context: CliContext) =>
  checkCommands([engine.commands], context.findCommand).missing

async function chooseName(
  entry: StarterEntry,
  engines: StarterEngine[],
  options: EngineOptions,
  context: CliContext,
  canAsk: boolean
): Promise<string> {
  const names = [...engines.map(({ name }) => name), EXISTING_BACKEND]
  if (options.engine) {
    if (!names.includes(options.engine)) {
      throw new DrxError(
        'usage',
        `The ${entry.name} starter has no engine named "${options.engine}". It offers: ${names.join(', ')}.`
      )
    }
    return options.engine
  }

  const missing = new Map(
    engines.map((engine) => [engine.name, missingFrom(engine, context)])
  )
  const present = engines.filter(({ name }) => missing.get(name)?.length === 0)
  const absent = engines.filter((engine) => !present.includes(engine))
  // The first engine that can run on this machine, or the starter's first.
  const fallback = (present[0] ?? engines[0]) as StarterEngine
  if (!canAsk) return fallback.name

  const choices: Choice<string>[] = [
    ...present.map(({ name, label }) => ({ value: name, label })),
    ...absent.map(({ name, label }) => ({
      value: name,
      label,
      hint: `not installed: ${missing.get(name)?.join(', ')}`,
    })),
    {
      value: EXISTING_BACKEND,
      label: 'None: use a backend that exists already',
    },
  ]
  return context.prompter.select({
    message: 'How should the backend run?',
    choices,
    initial: fallback.name,
  })
}

async function chooseDatabase(
  entry: StarterEntry,
  engine: StarterEngine,
  options: EngineOptions,
  context: CliContext,
  canAsk: boolean
): Promise<string | undefined> {
  const databases = engine.databases
  const of = `The ${engine.name} engine of the ${entry.name} starter`
  if (!databases) {
    if (options.database) {
      throw new DrxError('usage', `${of} offers no choice of database.`)
    }
    return undefined
  }
  if (options.database) {
    if (!databases.includes(options.database)) {
      throw new DrxError(
        'usage',
        `${of} has no database named "${options.database}". It offers: ${databases.join(', ')}.`
      )
    }
    return options.database
  }
  if (canAsk && databases.length > 1) {
    return context.prompter.select({
      message: 'Which database?',
      choices: databases.map((name) => ({ value: name, label: name })),
      initial: databases[0] as string,
    })
  }
  return databases[0]
}

async function existingBackend(
  entry: StarterEntry,
  engines: StarterEngine[],
  options: EngineOptions,
  context: CliContext,
  canAsk: boolean
): Promise<EngineChoice> {
  if (options.database) {
    throw new DrxError(
      'usage',
      `--database does not go with --engine ${EXISTING_BACKEND}. The backend has its database already.`
    )
  }
  let baseUrl = options.baseUrl
  if (!baseUrl) {
    if (!canAsk) {
      throw new DrxError(
        'usage',
        `--engine ${EXISTING_BACKEND} needs --base-url, the URL of the backend that exists already.`
      )
    }
    baseUrl = await context.prompter.text({
      message: 'What is the URL of the backend?',
    })
    assertBaseUrl(baseUrl)
  }
  return {
    name: EXISTING_BACKEND,
    label: `A backend that exists already, at ${baseUrl}`,
    needs: `A backend that exists already, at ${baseUrl}`,
    commands: [],
    baseUrl,
    writeUrl: baseUrl,
    steps: entry.druxt.steps ?? [],
    notes: [],
    keep: [],
    remove: engines.flatMap((engine) => engine.files ?? []),
  }
}

/**
 * Settles which engine the site is created with: the flag, the answer to a
 * prompt, or the first engine of the starter whose commands are on PATH.
 *
 * Undefined for a starter that lists no engines when none was asked for. The
 * engine for a backend that exists already is offered by every starter.
 */
export async function chooseEngine(
  entry: StarterEntry,
  options: EngineOptions,
  context: CliContext,
  canAsk: boolean
): Promise<EngineChoice | undefined> {
  const engines = entry.druxt.engines ?? []
  if (engines.length === 0 && !options.engine) {
    for (const [flag, value] of [
      ['--database', options.database],
      ['--base-url', options.baseUrl],
    ]) {
      if (value) {
        throw new DrxError(
          'usage',
          `${flag} goes with --engine, and the ${entry.name} starter lists no engines. Only --engine ${EXISTING_BACKEND} can be used with it.`
        )
      }
    }
    return undefined
  }

  const name = await chooseName(entry, engines, options, context, canAsk)
  if (name === EXISTING_BACKEND) {
    return existingBackend(entry, engines, options, context, canAsk)
  }

  const engine = engines.find((candidate) => candidate.name === name)
  if (!engine) throw new Error(`No engine named ${name}.`)
  if (options.baseUrl) {
    throw new DrxError(
      'usage',
      `--base-url goes with --engine ${EXISTING_BACKEND}. The ${name} engine serves the backend itself.`
    )
  }
  const database = await chooseDatabase(entry, engine, options, context, canAsk)
  return {
    name,
    label: engine.label,
    needs: engine.needs ?? engine.label,
    commands: engine.commands,
    ...(database ? { database } : {}),
    ...(engine.baseUrl ? { writeUrl: engine.baseUrl } : {}),
    ...(engine.project ? { project: engine.project } : {}),
    steps: engine.steps,
    notes: engine.notes ?? [],
    keep: engine.files ?? [],
    remove: engines
      .filter((other) => other !== engine)
      .flatMap((other) => other.files ?? []),
  }
}

/**
 * The steps as lines to type, starting in the site's root: a `cd` wherever
 * the directory changes, and one back to the root when a step returns there.
 */
export function stepLines(steps: EngineStep[]): string[] {
  const lines: string[] = []
  let here = ''
  for (const step of steps) {
    const dir = typeof step === 'string' ? '' : trimEndSlashes(step.dir)
    if (dir !== here) {
      const back = here
        .split('/')
        .filter(Boolean)
        .map(() => '..')
      lines.push(`cd ${[...back, dir].filter(Boolean).join('/')}`)
      here = dir
    }
    lines.push(typeof step === 'string' ? step : step.run)
  }
  return lines
}

/** The warning for an engine whose commands are not all on PATH. */
export function missingCommandsWarning(
  name: string,
  commands: string[],
  missing: string[]
): string {
  return `The ${name} engine needs ${describeAlternatives([commands])}. Not found on PATH: ${missing.join(', ')}. Install what is missing before you set up the site.`
}
