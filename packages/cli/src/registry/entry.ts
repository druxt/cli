import { isCommandName } from '../commands-on-path.js'
import { DrxError } from '../errors.js'
import { isLayout, LAYOUTS, type Layout } from '../layouts.js'
import { partsProblem, type Part } from '../parts.js'
import {
  isHttpUrl,
  isInsidePath,
  isNonEmptyString,
  isRecord,
  isStringArray,
} from '../validate.js'

export interface StarterRequirements {
  /** The Node version the site runs on, such as `16.18.1` or `22`. */
  node: string
  /** Other tools the site needs, each as a phrase to show the user. */
  tools: string[]
  /**
   * The commands the site needs on PATH, as alternatives: the site can be set
   * up when every command of any one inner list is there. `tools` is what the
   * user reads, and this is what `init` checks.
   */
  commands?: string[][]
}

/** A step of an engine: a command at the root, or one run in a directory. */
export type EngineStep = string | { run: string; dir: string }

/**
 * One way a starter's backend can be run. The name is data: the CLI has an
 * engine adapter for the names it can run tools through, and needs none to
 * create a site.
 */
export interface StarterEngine {
  name: string
  /** What the user reads in a prompt and under "It needs". */
  label: string
  /** The commands the engine needs on PATH. */
  commands: string[]
  /** The databases it can be set up with, the default first. */
  databases?: string[]
  /** What to run in the new site, in order. */
  steps: EngineStep[]
  /** What to do by hand, printed after the steps. */
  notes?: string[]
  /**
   * Paths in the starter that this engine needs, removed when another engine
   * is chosen. A path two engines list is kept when either is chosen.
   */
  files?: string[]
  /** The URL the engine serves the backend at, when it is fixed. */
  baseUrl?: string
}

/** Where a starter reads the URL of its backend from. */
export interface BackendUrlTarget {
  /** A file of `NAME=value` lines, relative to the starter's root. */
  file: string
  variable: string
  /** A file to start from when `file` does not exist. */
  template?: string
}

/** The engine every starter has: a backend that exists somewhere else. */
export const EXISTING_BACKEND = 'none'

/** What Druxt adds to a giget registry entry. giget ignores the key. */
export interface StarterDetails {
  /** The Druxt release line, such as `0.x`. */
  line: string
  layout: Layout
  parts: Part[]
  requires: StarterRequirements
  /** The date the starter was last checked to work, as YYYY-MM-DD. */
  maintained: string
  /** True for the starter `init` uses when none is named. */
  default: boolean
  /**
   * Commands to run in the new site, in order, when no engine is chosen or
   * the backend exists already.
   */
  steps?: string[]
  /** One sentence on what the starter is, for the prompt that lists it. */
  description?: string
  /** The ways the backend can be run. Supersedes `requires.commands`. */
  engines?: StarterEngine[]
  backendUrl?: BackendUrlTarget
  /** What the install of the site's package manager does past installing. */
  install?: StarterInstall
}

export interface StarterInstall {
  /** The steps the install runs itself, which are then not left to run. */
  runs?: string[]
  /** What to know once it has run, such as how to start the backend again. */
  notes?: string[]
}

/** A giget registry entry with the `druxt` object `init` needs. */
export interface StarterEntry {
  name: string
  tar: string
  defaultDir?: string
  url?: string
  subdir?: string
  headers?: Record<string, string>
  druxt: StarterDetails
}

function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

/** The first problem with `requires.commands`, or undefined. */
function commandsProblem(value: unknown): string | undefined {
  const at = 'druxt.requires.commands'
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    return `${at} must be a non-empty array of alternatives`
  }
  for (const [index, alternative] of value.entries()) {
    if (!Array.isArray(alternative) || alternative.length === 0) {
      return `${at}[${index}] must be a non-empty array of command names`
    }
    for (const [position, name] of alternative.entries()) {
      if (!isCommandName(name)) {
        return `${at}[${index}][${position}] must be a command name with no path or spaces`
      }
    }
  }
  return undefined
}

const INSIDE = 'must be a relative path inside the starter'

function stepProblem(step: unknown, at: string): string | undefined {
  if (typeof step === 'string') {
    return step.trim() === ''
      ? `${at} must be a command, or an object with run and dir`
      : undefined
  }
  if (!isRecord(step))
    return `${at} must be a command, or an object with run and dir`
  if (!isNonEmptyString(step.run)) return `${at}.run must be a non-empty string`
  if (!isInsidePath(step.dir)) return `${at}.dir ${INSIDE}`
  return undefined
}

/** The first problem with `druxt.engines`, or undefined. */
function enginesProblem(value: unknown): string | undefined {
  const label = 'druxt.engines'
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    return `${label} must be a non-empty array`
  }
  const names = new Set<string>()
  for (const [index, engine] of value.entries()) {
    const at = `${label}[${index}]`
    if (!isRecord(engine)) return `${at} must be an object`

    const name = engine.name
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      return `${at}.name must be a lower-case name`
    }
    if (name === EXISTING_BACKEND) {
      return `${at}.name cannot be ${EXISTING_BACKEND}, which every starter has`
    }
    if (names.has(name)) return `${at}.name repeats the name ${name}`
    names.add(name)

    if (!isNonEmptyString(engine.label)) {
      return `${at}.label must be a non-empty string`
    }
    if (!Array.isArray(engine.commands)) {
      return `${at}.commands must be an array of command names`
    }
    for (const [position, command] of engine.commands.entries()) {
      if (!isCommandName(command)) {
        return `${at}.commands[${position}] must be a command name with no path or spaces`
      }
    }
    const databases = engine.databases
    if (
      databases !== undefined &&
      (!Array.isArray(databases) ||
        databases.length === 0 ||
        !databases.every(isNonEmptyString))
    ) {
      return `${at}.databases must be a non-empty array of names`
    }
    if (!Array.isArray(engine.steps)) return `${at}.steps must be an array`
    for (const [position, step] of engine.steps.entries()) {
      const problem = stepProblem(step, `${at}.steps[${position}]`)
      if (problem) return problem
    }
    if (engine.notes !== undefined && !isStringArray(engine.notes)) {
      return `${at}.notes must be an array of strings`
    }
    if (engine.baseUrl !== undefined && !isHttpUrl(engine.baseUrl)) {
      return `${at}.baseUrl must be an http or https URL`
    }
    if (engine.files !== undefined) {
      if (!Array.isArray(engine.files)) {
        return `${at}.files must be an array of paths`
      }
      for (const [position, file] of engine.files.entries()) {
        if (!isInsidePath(file)) return `${at}.files[${position}] ${INSIDE}`
      }
    }
  }
  return undefined
}

/** The first problem with `druxt.backendUrl`, or undefined. */
function backendUrlProblem(value: unknown): string | undefined {
  const at = 'druxt.backendUrl'
  if (value === undefined) return undefined
  if (!isRecord(value)) return `${at} must be an object`
  if (!isInsidePath(value.file)) return `${at}.file ${INSIDE}`
  if (
    typeof value.variable !== 'string' ||
    !/^[a-z_][a-z0-9_]*$/i.test(value.variable)
  ) {
    return `${at}.variable must be the name of a variable`
  }
  if (value.template !== undefined && !isInsidePath(value.template)) {
    return `${at}.template ${INSIDE}`
  }
  return undefined
}

/** The first problem with an entry, or undefined when it is valid. */
function entryProblem(entry: unknown): string | undefined {
  if (!isRecord(entry)) return 'the entry must be an object'
  if (!isNonEmptyString(entry.name)) return 'name must be a non-empty string'
  if (!isHttpUrl(entry.tar)) return 'tar must be an http or https URL'
  for (const key of ['defaultDir', 'url', 'subdir']) {
    if (entry[key] !== undefined && typeof entry[key] !== 'string') {
      return `${key} must be a string`
    }
  }
  if (entry.headers !== undefined) {
    const headers = entry.headers
    if (!isRecord(headers) || !isStringArray(Object.values(headers))) {
      return 'headers must be an object of strings'
    }
  }

  const druxt = entry.druxt
  if (!isRecord(druxt)) return 'druxt must be an object'
  if (!isNonEmptyString(druxt.line)) {
    return 'druxt.line must be a non-empty string'
  }
  if (!isLayout(druxt.layout)) {
    return `druxt.layout must be one of ${LAYOUTS.join(', ')}`
  }
  const parts = partsProblem(druxt.parts, 'druxt.parts')
  if (parts) return parts
  const requires = druxt.requires
  if (!isRecord(requires)) return 'druxt.requires must be an object'
  if (!isNonEmptyString(requires.node)) {
    return 'druxt.requires.node must be a non-empty string'
  }
  if (!isStringArray(requires.tools)) {
    return 'druxt.requires.tools must be an array of strings'
  }
  const commands = commandsProblem(requires.commands)
  if (commands) return commands
  if (!isIsoDate(druxt.maintained)) {
    return 'druxt.maintained must be an ISO date (YYYY-MM-DD)'
  }
  if (typeof druxt.default !== 'boolean') {
    return 'druxt.default must be true or false'
  }
  if (druxt.steps !== undefined && !isStringArray(druxt.steps)) {
    return 'druxt.steps must be an array of strings'
  }
  if (
    druxt.description !== undefined &&
    typeof druxt.description !== 'string'
  ) {
    return 'druxt.description must be a string'
  }
  const install = druxt.install
  if (install !== undefined) {
    if (!isRecord(install)) return 'druxt.install must be an object'
    for (const key of ['runs', 'notes']) {
      if (install[key] !== undefined && !isStringArray(install[key])) {
        return `druxt.install.${key} must be an array of strings`
      }
    }
  }
  return enginesProblem(druxt.engines) ?? backendUrlProblem(druxt.backendUrl)
}

/**
 * Checks a registry entry before anything is downloaded from it. The error
 * names the first field that is wrong.
 */
export function validateEntry(entry: unknown, name: string): StarterEntry {
  const problem = entryProblem(entry)
  if (problem) {
    throw new DrxError(
      'invalid-entry',
      `Starter entry "${name}" is invalid: ${problem}.`
    )
  }
  return entry as StarterEntry
}
