import { stripVTControlCharacters } from 'node:util'
import { defineCommand, renderUsage, runCommand, type CommandDef } from 'citty'
import { infoCommand } from './commands/info.js'
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
      info: infoCommand(context),
    },
  })
}

/** citty colours its output whatever it writes to. A pipe gets plain text. */
function plain(stream: TextStream, text: string): string {
  return stream.isTTY ? text : stripVTControlCharacters(text)
}

/** The usage of the command the arguments name, or of `drx` itself. */
async function usage(
  main: CommandDef,
  subCommands: Record<string, CommandDef>,
  argv: string[]
): Promise<string> {
  const name = argv.find((argument) => !argument.startsWith('-'))
  const command = name ? subCommands[name] : undefined
  return command ? renderUsage(command, main) : renderUsage(main)
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
  const subCommands = main.subCommands as Record<string, CommandDef>
  const { stdout, stderr } = context

  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      stdout.write(`${plain(stdout, await usage(main, subCommands, argv))}\n`)
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
