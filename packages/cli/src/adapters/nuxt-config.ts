import { generateCode, parseModule } from 'magicast'
import { getDefaultExportOptions } from 'magicast/helpers'

/** The key Druxt modules are listed under, in Nuxt 2 and later alike. */
const KEY = 'modules'

/** The result of trying to change the modules list of a config. */
export type ConfigEdit =
  | { kind: 'changed'; content: string }
  | { kind: 'unchanged' }
  /** The file is not a shape that can be edited without guessing. */
  | { kind: 'unsafe' }

/** The name of one entry of the list: a string, or the first of an array. */
function entryName(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  if (
    Array.isArray(entry) ||
    (entry as { $type?: string })?.$type === 'array'
  ) {
    const first = (entry as unknown[])[0]
    return typeof first === 'string' ? first : undefined
  }
  return undefined
}

/**
 * Adds a module to, or removes it from, the `modules` array of a Nuxt
 * config, keeping the rest of the file as it is written.
 *
 * It edits a config that exports an object, or a call such as
 * `defineNuxtConfig` with one, whose `modules` is an array written out in
 * the file. Anything else, such as a function or a list held in a variable,
 * is reported as unsafe and left for a person.
 */
export function editModules(
  source: string,
  name: string,
  action: 'add' | 'remove'
): ConfigEdit {
  try {
    const module = parseModule(source)
    const config = getDefaultExportOptions(module)
    if (config?.$type !== 'object') return { kind: 'unsafe' }

    const list = config[KEY]
    if (list === undefined) {
      if (action === 'remove') return { kind: 'unchanged' }
      config[KEY] = [name]
    } else {
      if (list.$type !== 'array') return { kind: 'unsafe' }
      const index = [...list].findIndex((entry) => entryName(entry) === name)
      if (action === 'add') {
        if (index !== -1) return { kind: 'unchanged' }
        list.push(name)
      } else {
        if (index === -1) return { kind: 'unchanged' }
        list.splice(index, 1)
      }
    }

    const { code } = generateCode(module)
    // The printer drops the newline a file ends with.
    return {
      kind: 'changed',
      content:
        source.endsWith('\n') && !code.endsWith('\n') ? `${code}\n` : code,
    }
  } catch {
    return { kind: 'unsafe' }
  }
}
