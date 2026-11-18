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

/** The names in the modules list of a config, or undefined when it has none. */
function names(source: string): (string | undefined)[] | undefined {
  try {
    const list = getDefaultExportOptions(parseModule(source))?.[KEY]
    return list?.$type === 'array' ? [...list].map(entryName) : undefined
  } catch {
    return undefined
  }
}

const SPACE = /[ \t]/

/**
 * The source with one element of an array taken out, along with its comma
 * and the line it had to itself. Undefined when the parser gave no positions.
 */
function withoutElement(
  source: string,
  array: unknown,
  index: number
): string | undefined {
  const elements = (array as { elements?: { start?: number; end?: number }[] })
    .elements
  const element = elements?.[index]
  if (typeof element?.start !== 'number' || typeof element.end !== 'number') {
    return undefined
  }
  let { start, end } = element
  let after = end
  while (/\s/.test(source[after] ?? '')) after += 1

  if (source[after] !== ',') {
    // The last element: the comma before it goes, when there is one.
    let before = start
    while (before > 0 && /\s/.test(source[before - 1] ?? '')) before -= 1
    if (source[before - 1] === ',') start = before - 1
    return source.slice(0, start) + source.slice(end)
  }

  end = after + 1
  let lineStart = start
  while (lineStart > 0 && SPACE.test(source[lineStart - 1] ?? '')) {
    lineStart -= 1
  }
  let lineEnd = end
  while (SPACE.test(source[lineEnd] ?? '')) lineEnd += 1
  const ownLine =
    (lineStart === 0 || source[lineStart - 1] === '\n') &&
    (source[lineEnd] === '\n' || source.startsWith('\r\n', lineEnd))
  if (ownLine) {
    return (
      source.slice(0, lineStart) +
      source.slice(lineEnd + (source[lineEnd] === '\r' ? 2 : 1))
    )
  }
  // Written on one line with its neighbours.
  return source.slice(0, start) + source.slice(lineEnd)
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
        // The printer rewrites a whole array it has taken an entry out of.
        // Cutting the entry out of the text leaves the rest as written.
        const cut = withoutElement(source, list.$ast, index)
        if (cut !== undefined && names(cut)?.includes(name) === false) {
          return { kind: 'changed', content: cut }
        }
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
