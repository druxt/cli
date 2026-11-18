import { isCommandName } from '../commands-on-path.js'
import { DrxError } from '../errors.js'
import { isLayout, LAYOUTS, type Layout } from '../layouts.js'
import { partsProblem, type Part } from '../parts.js'
import {
  isHttpUrl,
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
  /** Commands to run in the new site, in order. */
  steps?: string[]
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
  return undefined
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
