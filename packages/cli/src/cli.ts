import { stripVTControlCharacters } from 'node:util'
import { defineCommand, renderUsage, runCommand, type CommandDef } from 'citty'
import { infoCommand } from './commands/info.js'
import { initCommand } from './commands/init.js'
import { moduleCommand } from './commands/module.js'
import { defaultContext, type CliContext, type TextStream } from './context.js'
import { DrxError } from './errors.js'
import { cliVersion } from './package-root.js'

function mainCommand(context: CliContext) {
  return defineCommand({
    meta: {
      name: 'drx',
      version: cliVersion(),
      description: 'The Druxt command-line tool',
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

/**
 * Runs the CLI with the given arguments and returns the exit code. It never
 * exits the process or throws, so a caller decides what to do with the code.
 */
export async function runCli(
  argv: string[],
  overrides: Partial<CliContext> = {}
): Promise<number> {
  const context = { ...defaultContext(), ...overrides }
  const main = mainCommand(context)
  const { stdout, stderr } = context

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
    if (argv.length === 0) {
      stderr.write(`${plain(stderr, await renderUsage(main))}\n`)
      return 1
    }
    await runCommand(main, { rawArgs: argv })
    return 0
  } catch (error) {
    const failure = describe(error)
    if (argv.includes('--json')) {
      stdout.write(
        `${JSON.stringify({ ok: false, error: failure }, null, 2)}\n`
      )
    }
    stderr.write(`Error: ${failure.message}\n`)
    return 1
  }
}
