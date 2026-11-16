import { stripVTControlCharacters } from 'node:util'
import {
  defineCommand,
  renderUsage,
  runCommand,
  type ArgsDef,
  type CommandDef,
} from 'citty'
import { addCommand, removeCommand } from './commands/change.js'
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
      add: addCommand(context),
      remove: removeCommand(context),
      module: moduleCommand(context, {
        add: addCommand(context, 'module add'),
        remove: removeCommand(context, 'module remove'),
      }),
    },
  })
}

/** citty colours its output whatever it writes to. A pipe gets plain text. */
function plain(stream: TextStream, text: string): string {
  return stream.isTTY ? text : stripVTControlCharacters(text)
}

/**
 * The usage of the command the arguments name, or of `drx` itself. A command
 * may hold commands of its own, so the names are followed as far as they go.
 */
async function usage(main: CommandDef, argv: string[]): Promise<string> {
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
  return renderUsage(command, parent)
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
 * Whether anything may be asked. A terminal is needed, and `CI`,
 * `DRX_NO_INTERACTIVE` and `--no-interactive` each say no whatever the
 * terminal is. A command then takes its defaults, and fails naming the flag
 * of a value that has none.
 */
function mayAsk(context: CliContext, argv: string[]): boolean {
  const off = (value: string | undefined) =>
    value !== undefined && value !== '' && value !== '0' && value !== 'false'
  return (
    context.interactive &&
    !argv.includes(NO_INTERACTIVE) &&
    !off(context.env.DRX_NO_INTERACTIVE) &&
    !off(context.env.CI)
  )
}

/** Runs one command line in a context that is already settled. */
async function execute(argv: string[], context: CliContext): Promise<number> {
  const main = mainCommand(context)
  const { stdout, stderr } = context
  const json = argv.includes('--json')

  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      stdout.write(`${plain(stdout, await usage(main, argv))}\n`)
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
    await runCommand(main, { rawArgs: argv })
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
  return execute(
    argv.filter((argument) => argument !== NO_INTERACTIVE),
    { ...context, interactive: mayAsk(context, argv) }
  )
}
