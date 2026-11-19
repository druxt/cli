import type { ArgsDef, CommandDef } from 'citty'
import { describe, expect, test } from 'vitest'
import { mainCommand, optionsAfterCommand } from '../src/cli.js'
import { defaultContext } from '../src/context.js'

const main = mainCommand(defaultContext())

/** Every command of the tree with the names that lead to it. */
function commands(
  command: CommandDef,
  path: string[] = []
): { path: string[]; args: ArgsDef }[] {
  const below = (command.subCommands ?? {}) as Record<string, CommandDef>
  return [
    ...(path.length > 0
      ? [{ path, args: (command.args ?? {}) as ArgsDef }]
      : []),
    ...Object.entries(below).flatMap(([name, next]) =>
      commands(next, [...path, name])
    ),
  ]
}

/** Each way an option of a command is written, as the arguments it takes. */
function forms(args: ArgsDef): string[][] {
  return Object.entries(args).flatMap(([name, definition]) => {
    if (definition.type === 'positional') return []
    const alias = 'alias' in definition ? definition.alias : undefined
    const names = [`--${name}`, ...[alias ?? []].flat().map((one) => `-${one}`)]
    if (definition.type === 'boolean') {
      return [...names.map((flag) => [flag]), [`--no-${name}`]]
    }
    return [
      ...names.map((flag) => [flag, 'a-value']),
      [`--${name}=a-value`],
      // A value that is the name of a command is still a value.
      ...names.map((flag) => [flag, 'list']),
      ...names.map((flag) => [flag, 'info']),
    ]
  })
}

const CASES = commands(main).flatMap(({ path, args }) =>
  forms(args).map((option) => ({ path, option }))
)

describe('an option before a command is the option after it', () => {
  test('the tree has commands and options to check', () => {
    expect(CASES.length).toBeGreaterThan(30)
    expect(CASES.some(({ path }) => path.length === 2)).toBe(true)
  })

  test.each(CASES)('drx $path with $option', ({ path, option }) => {
    const after = [...path, ...option, 'something']
    expect(optionsAfterCommand(main, after)).toEqual(after)
    // Before every name of the path, and between any two of them.
    for (let at = 0; at < path.length; at++) {
      const before = [...path.slice(0, at), ...option, ...path.slice(at)]
      expect(optionsAfterCommand(main, [...before, 'something'])).toEqual(after)
    }
  })

  test('options keep their order, and what follows -- is left alone', () => {
    expect(
      optionsAfterCommand(main, [
        '--json',
        'module',
        '--type',
        'contrib',
        'list',
        '--all',
        '--',
        '--refresh',
      ])
    ).toEqual([
      'module',
      'list',
      '--json',
      '--type',
      'contrib',
      '--all',
      '--',
      '--refresh',
    ])
  })

  test('the options of drx itself stay before the command', () => {
    expect(optionsAfterCommand(main, ['--interactive', 'info'])).toEqual([
      '--interactive',
      'info',
    ])
  })

  test('arguments that name no command are left as they are', () => {
    for (const argv of [
      ['launch'],
      ['--json'],
      ['--type', 'x', 'launch'],
      [],
    ]) {
      expect(optionsAfterCommand(main, argv)).toEqual(argv)
    }
  })
})
