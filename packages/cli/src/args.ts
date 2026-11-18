import type { ArgsDef } from 'citty'
import { DrxError } from './errors.js'

/**
 * Fails on an option the command does not define. citty accepts any flag
 * and hands it to the command, so a mistyped one would otherwise be ignored.
 */
export function assertKnownOptions(
  rawArgs: string[],
  definitions: ArgsDef,
  command: string
): void {
  const known = new Set<string>()
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.type === 'positional') continue
    known.add(name)
    if (definition.type === 'boolean') known.add(`no-${name}`)
    const alias = 'alias' in definition ? definition.alias : undefined
    for (const short of [alias ?? []].flat()) known.add(short)
  }

  for (const argument of rawArgs) {
    if (argument === '--') return
    if (!argument.startsWith('-') || argument === '-') continue
    const name = argument.replace(/^--?/, '').split('=')[0] ?? ''
    if (!known.has(name)) {
      throw new DrxError(
        'usage',
        `Unknown option ${argument.split('=')[0]}. Run "drx ${command} --help" for the options.`
      )
    }
  }
}
