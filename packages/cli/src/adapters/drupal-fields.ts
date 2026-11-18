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

/**
 * The characters a Composer version constraint is made of: versions,
 * operators, ranges, stability flags, branch names and references. It
 * starts with a version or an operator, never with a hyphen.
 */
const CONSTRAINT = /^[A-Za-z0-9^~<>=!*][A-Za-z0-9 .*^~<>=!|,@#/_+-]*$/
const CONSTRAINT_RULE = 'must be a Composer version constraint'

/** No name or constraint is anywhere near this long. */
const LENGTH = 200

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
    !matches(composer.constraint, CONSTRAINT)
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
