import { stripVTControlCharacters } from 'node:util'
import { runCli } from '../../src/cli.js'
import type { CliContext } from '../../src/context.js'
import { tmp } from './tmp.js'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  /** The output with its escape codes left in. */
  raw: { stdout: string; stderr: string }
}

/**
 * Runs the CLI in-process with captured output, no terminal, a fixed Node
 * version, and user configuration and cache directories that are empty.
 */
export async function run(
  argv: string[],
  overrides: Partial<CliContext> = {},
  terminal?: { columns: number }
): Promise<RunResult> {
  let stdout = ''
  let stderr = ''
  // A terminal: both streams say so, and somebody is there to answer.
  const tty = terminal ? { isTTY: true, columns: terminal.columns } : {}
  const code = await runCli(argv, {
    cwd: tmp(),
    env: { XDG_CONFIG_HOME: tmp('drx-config-') },
    cacheDir: tmp('drx-cache-'),
    stdout: { write: (chunk) => (stdout += chunk), ...tty },
    stderr: { write: (chunk) => (stderr += chunk), ...tty },
    interactive: terminal !== undefined,
    nodeVersion: '24.18.0',
    ...overrides,
  })
  return {
    code,
    stdout: stripVTControlCharacters(stdout),
    stderr: stripVTControlCharacters(stderr),
    raw: { stdout, stderr },
  }
}
