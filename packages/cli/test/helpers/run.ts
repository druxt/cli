import { stripVTControlCharacters } from 'node:util'
import { runCli } from '../../src/cli.js'
import type { CliContext } from '../../src/context.js'
import { tmp } from './tmp.js'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Runs the CLI in-process with captured output, no terminal, a fixed Node
 * version and a user configuration directory that is empty.
 */
export async function run(
  argv: string[],
  overrides: Partial<CliContext> = {}
): Promise<RunResult> {
  let stdout = ''
  let stderr = ''
  const code = await runCli(argv, {
    cwd: tmp(),
    env: { XDG_CONFIG_HOME: tmp('drx-config-') },
    stdout: { write: (chunk) => (stdout += chunk) },
    stderr: { write: (chunk) => (stderr += chunk) },
    interactive: false,
    nodeVersion: '24.18.0',
    ...overrides,
  })
  return {
    code,
    stdout: stripVTControlCharacters(stdout),
    stderr: stripVTControlCharacters(stderr),
  }
}
