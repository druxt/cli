import { stripVTControlCharacters } from 'node:util'
import {
  defineCommand,
  renderUsage,
  runCommand,
  type ArgsDef,
  type CommandDef,
} from 'citty'
import { infoCommand } from './commands/info.js'
import { initCommand } from './commands/init.js'
import { runMenu } from './commands/menu.js'
import { moduleCommand } from './commands/module.js'
import { defaultContext, type CliContext, type TextStream } from './context.js'
import { DrxError } from './errors.js'
import { createOutput } from './output.js'
import { cliVersion } from './package-root.js'

function mainCommand(context: CliContext): CommandDef {
  return defineCommand<ArgsDef>({
    meta: {
      name: 'drx',
      version: cliVersion(),
      description: 'The Druxt command-line tool',
    },
    args: {
      interactive: {
        type: 'boolean',
        default: true,
        description: 'Ask for what is missing when there is a terminal',
        negativeDescription:
          'Never ask, draw or wait: for CI and scripts. DRX_NO_INTERACTIVE=1 does the same',
      },
    },
    subCommands: {
      init: initCommand(context),
      info: infoCommand(context),
      module: moduleCommand(context),
    },
  })
}

/** citty colours its output whatever it writes to. A pipe gets plain text. */
function plain(stream: TextStream, text: string): string {
  return stream.isTTY ? text : stripVTControlCharacters(text)
}

/** The meta of a command, which citty lets be a value, a promise or a function. */
async function resolveMeta(command: CommandDef) {
  const { meta } = command
  return typeof meta === 'function' ? await meta() : await meta
}

/**
 * The usage of the command the arguments name, or of `drx` itself. A command
 * may hold commands of its own, so the names are followed as far as they go.
 */
async function usage(
  main: CommandDef,
  argv: string[],
  startedAs: CliContext['startedAs']
): Promise<string> {
  let command = main
  let parent: CommandDef | undefined
  let path = 'drx'
  for (const name of argv.filter((argument) => !argument.startsWith('-'))) {
    const next = (
      command.subCommands as Record<string, CommandDef> | undefined
    )?.[name]
    if (!next) break
    parent = { meta: { name: path } }
    path = `${path} ${name}`
    command = next
  }
  if (startedAs && path === `drx ${startedAs.command}`) {
    const meta = { ...(await resolveMeta(command)), name: startedAs.name }
    return renderUsage({ ...command, meta })
  }
  return renderUsage(command, parent)
}

/** True when an option takes the argument after it as its value. */
function takesValue(option: string, args: ArgsDef): boolean {
  if (option.includes('=')) return false
  const name = option.replace(/^--?/, '')
  return Object.entries(args).some(([key, definition]) => {
    if (definition.type !== 'string' && definition.type !== 'enum') return false
    const alias = 'alias' in definition ? definition.alias : undefined
    return key === name || [alias ?? []].flat().includes(name)
  })
}

/**
 * The arguments with an option of a group moved to after the command it was
 * given before, so `module --json list` reads as `module list --json`. citty
 * hands a command only what follows its name, and an option between a group
 * and its command would be dropped without a word. The command then takes
 * the option or refuses it, as it does one given after its name. The options
 * of `drx` itself stay where they are.
 */
function optionsAfterCommand(main: CommandDef, argv: string[]): string[] {
  const head: string[] = []
  let rest = argv
  for (let command = main; ;) {
    const subCommands = command.subCommands as
      Record<string, CommandDef> | undefined
    if (!subCommands) break
    const args = (command.args ?? {}) as ArgsDef
    let index = 0
    while (rest[index]?.startsWith('-') && rest[index] !== '--') {
      index += takesValue(rest[index] as string, args) ? 2 : 1
    }
    const name = rest[index]
    const next = name === undefined ? undefined : subCommands[name]
    if (name === undefined || !next) break
    const options = rest.slice(0, index)
    if (command === main) {
      head.push(...options, name)
      rest = rest.slice(index + 1)
    } else {
      head.push(name)
      rest = [...options, ...rest.slice(index + 1)]
    }
    command = next
  }
  return [...head, ...rest]
}

/** The code and message to report for anything a command throws. */
function describe(error: unknown): { code: string; message: string } {
  if (error instanceof DrxError) {
    return { code: error.code, message: error.message }
  }
  // citty's own error for a bad argument or command. The class is not
  // exported, so it is recognised by name.
  if (error instanceof Error && error.name === 'CLIError') {
    return {
      code: 'usage',
      message: `${stripVTControlCharacters(error.message)}. Run "drx --help" for the commands and "drx <command> --help" for their options.`,
    }
  }
  return {
    code: 'unexpected',
    message:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
  }
}

/** The flag that turns every prompt off. It goes before or after a command. */
const NO_INTERACTIVE = '--no-interactive'

/**
 * What says nothing may be asked although there is a terminal: `CI`,
 * `DRX_NO_INTERACTIVE` or `--no-interactive`, each of which says no whatever
 * the terminal is. A command then takes its defaults, and fails naming the
 * flag of a value that has none. Undefined when nothing turned the questions
 * off, or when there is no terminal to ask on in the first place.
 */
function questionsOff(context: CliContext, argv: string[]): string | undefined {
  const on = (value: string | undefined) =>
    value !== undefined && value !== '' && value !== '0' && value !== 'false'
  if (!context.interactive) return undefined
  if (argv.includes(NO_INTERACTIVE)) return NO_INTERACTIVE
  if (on(context.env.DRX_NO_INTERACTIVE)) return 'DRX_NO_INTERACTIVE'
  if (on(context.env.CI)) return 'CI'
  return undefined
}

/** Runs one command line in a context that is already settled. */
async function execute(argv: string[], context: CliContext): Promise<number> {
  const main = mainCommand(context)
  const { stdout, stderr } = context
  const json = argv.includes('--json')

  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      stdout.write(
        `${plain(stdout, await usage(main, argv, context.startedAs))}\n`
      )
      return 0
    }
    if (argv.length === 1 && ['--version', '-v'].includes(argv[0] ?? '')) {
      stdout.write(`${cliVersion()}\n`)
      return 0
    }
    // Bare `drx`: a menu for a person, the usage for anything else.
    if (argv.every((argument) => argument === '--no-banner')) {
      if (context.interactive) {
        return await runMenu(context, { banner: argv.length === 0 }, (next) =>
          execute(next, context)
        )
      }
      stderr.write(`${plain(stderr, await renderUsage(main))}\n`)
      return 1
    }
    await runCommand(main, { rawArgs: optionsAfterCommand(main, argv) })
    return 0
  } catch (error) {
    const failure = describe(error)
    if (json) {
      stdout.write(
        `${JSON.stringify({ ok: false, error: failure }, null, 2)}\n`
      )
    }
    // In a terminal the line carries the mark for a failure. The word stays.
    const output = createOutput(context, json)
    const mark = output.decorated ? `${output.err.mark('failed')} ` : ''
    stderr.write(`${mark}Error: ${failure.message}\n`)
    return 1
  }
}

/**
 * Runs the CLI with the given arguments and returns the exit code. It never
 * exits the process or throws, so a caller decides what to do with the code.
 */
export async function runCli(
  argv: string[],
  overrides: Partial<CliContext> = {}
): Promise<number> {
  const context = { ...defaultContext(), ...overrides }
  const off = questionsOff(context, argv)
  return execute(
    argv.filter((argument) => argument !== NO_INTERACTIVE),
    {
      ...context,
      interactive: context.interactive && off === undefined,
      ...(off === undefined ? {} : { questionsOff: off }),
    }
  )
}
