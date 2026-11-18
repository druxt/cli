import type { FieldProblem } from './adapter.js'

/** A module's machine name, as the backend itself defines one. */
const MACHINE_NAME = /^[a-z][a-z0-9_]*$/
const MACHINE_NAME_RULE =
  'must be a machine name: lower-case letters, digits and underscores, starting with a letter'

/**
 * What is wrong with a module the registry lists for this kind. Its name is
 * handed to the backend's tools as an argument, so anything but a machine
 * name is refused here: an option, a list, or a character a shell reads.
 */
export function moduleProblem(module: {
  name: string
}): FieldProblem | undefined {
  if (!MACHINE_NAME.test(module.name)) {
    return { field: 'name', must: MACHINE_NAME_RULE }
  }
  return undefined
}
