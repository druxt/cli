import type { BackendModule } from '../modules/entry.js'
import type { BackendRecord, FieldProblem } from './adapter.js'

/** A module's machine name, as the backend itself defines one. */
const MACHINE_NAME = /^[a-z][a-z0-9_]*$/
const MACHINE_NAME_RULE =
  'must be a machine name: lower-case letters, digits and underscores, starting with a letter'

/**
 * The name of a Composer package, as Composer defines one: a vendor and a
 * name in lower case, each of letters and digits joined by single
 * separators. Written so that it is matched in linear time.
 */
const PACKAGE =
  /^[a-z0-9]+(?:[_.-][a-z0-9]+)*\/[a-z0-9]+(?:(?:[_.]|-{1,2})[a-z0-9]+)*$/
const PACKAGE_RULE = 'must be the name of a Composer package, as in vendor/name'

/** No name or constraint is anywhere near this long. */
const LENGTH = 200

/**
 * The characters a Composer version constraint is made of: versions,
 * operators, ranges, stability flags, branch names and references.
 */
const CONSTRAINT_CHARACTERS = /^[A-Za-z0-9 .*^~<>=!|,@#/_+-]+$/
const CONSTRAINT_RULE = 'must be a Composer version constraint'

/** The parts of one constraint, each written to be matched in linear time. */
const OPERATOR = '(?:\\^|~|<=?|>=?|==?|!=|<>)'
const STABILITY = '(?:@(?:dev|alpha|beta|rc|stable))?'
const REFERENCE = '(?:#[A-Za-z0-9]+)?'
/** A version: digits or a wildcard, then parts joined by single separators. */
const VERSION = `v?(?:[0-9]+|[*xX])(?:[.+_-][A-Za-z0-9*]+)*${STABILITY}${REFERENCE}`
const A_VERSION = new RegExp(`^${VERSION}$`, 'i')
const A_TERM = new RegExp(`^${OPERATOR}?${VERSION}$`, 'i')
const AN_OPERATOR = new RegExp(`^${OPERATOR}$`)
const A_BRANCH = new RegExp(
  `^dev-[A-Za-z0-9][A-Za-z0-9._/+-]*${STABILITY}${REFERENCE}$`,
  'i'
)
const A_STABILITY = /^@(?:dev|alpha|beta|rc|stable)$/i

/**
 * True when the words are constraints that all have to hold, as Composer
 * reads them between two `||`: a version with or without an operator, an
 * operator and its version apart, a branch, a stability flag, a range as in
 * `1.0 - 2.0`, or an alias as in `dev-main as 1.0.0`. A word that begins
 * with a hyphen is none of them, so an option is never one.
 */
function allHold(words: string[]): boolean {
  if (words.length === 0) return false
  for (let index = 0; index < words.length;) {
    const word = words[index] as string
    const next = words[index + 1] ?? ''
    if (AN_OPERATOR.test(word)) {
      if (!A_VERSION.test(next)) return false
      index += 2
      continue
    }
    const version = A_VERSION.test(word)
    if (!version && !A_TERM.test(word)) {
      if (!A_BRANCH.test(word) && !A_STABILITY.test(word)) return false
    }
    index += 1
    const joins = words[index]
    if (joins !== '-' && joins !== 'as') continue
    // A range is between two versions, and an alias names a version.
    const from = joins === '-' ? version : version || A_BRANCH.test(word)
    if (!from || !A_VERSION.test(words[index + 1] ?? '')) return false
    index += 2
  }
  return true
}

/**
 * True for a set of version constraints as Composer writes them: one or
 * more groups joined by `||` or `|`, each of constraints joined by spaces or
 * commas. It is handed to Composer as one argument after the name of the
 * package, and checked here so that nothing but a constraint gets that far.
 */
function isConstraint(value: string): boolean {
  if (!CONSTRAINT_CHARACTERS.test(value)) return false
  if (value.includes('|||') || value.includes(',,')) return false
  return value
    .replaceAll('||', '|')
    .split('|')
    .every((group) => {
      const trimmed = group.trim()
      if (trimmed.startsWith(',') || trimmed.endsWith(',')) return false
      return allHold(
        trimmed
          .replaceAll(',', ' ')
          .split(' ')
          .filter((word) => word !== '')
      )
    })
}

const matches = (value: string, pattern: RegExp) =>
  value.length <= LENGTH && pattern.test(value)

/**
 * What is wrong with a module the registry lists for this kind. Its name,
 * its package and its constraint are handed to the backend's tools as
 * arguments, so anything but the form each has is refused here: an option,
 * a list, or a character a shell reads.
 */
export function moduleProblem(module: BackendModule): FieldProblem | undefined {
  if (!matches(module.name, MACHINE_NAME)) {
    return { field: 'name', must: MACHINE_NAME_RULE }
  }
  const { composer } = module
  if (composer && !matches(composer.package, PACKAGE)) {
    return { field: 'composer.package', must: PACKAGE_RULE }
  }
  if (
    composer?.constraint !== undefined &&
    !(composer.constraint.length <= LENGTH && isConstraint(composer.constraint))
  ) {
    return { field: 'composer.constraint', must: CONSTRAINT_RULE }
  }
  for (const [index, patch] of (module.patches ?? []).entries()) {
    if (patch.package !== undefined && !matches(patch.package, PACKAGE)) {
      return { field: `patches[${index}].package`, must: PACKAGE_RULE }
    }
  }
  return undefined
}

/**
 * What is wrong with a record of what an add did to a part of this kind.
 * The record is in a file of the project, which a clone brings with it, and
 * a remove hands its names to the same tools.
 */
export function recordProblem(record: BackendRecord): FieldProblem | undefined {
  for (const [index, module] of record.modules.entries()) {
    if (!matches(module.name, MACHINE_NAME)) {
      return { field: `modules[${index}].name`, must: MACHINE_NAME_RULE }
    }
    if (module.package !== undefined && !matches(module.package, PACKAGE)) {
      return { field: `modules[${index}].package`, must: PACKAGE_RULE }
    }
  }
  for (const [index, patch] of record.patches.entries()) {
    if (!matches(patch.package, PACKAGE)) {
      return { field: `patches[${index}].package`, must: PACKAGE_RULE }
    }
    if (patch.module !== undefined && !matches(patch.module, MACHINE_NAME)) {
      return { field: `patches[${index}].module`, must: MACHINE_NAME_RULE }
    }
  }
  return undefined
}
