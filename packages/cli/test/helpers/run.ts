import { join } from 'node:path'
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
 * version, and user configuration and cache directories that are empty.
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
    cacheDir: tmp('drx-cache-'),
    stdout: { write: (chunk) => (stdout += chunk) },
    stderr: { write: (chunk) => (stderr += chunk) },
    interactive: false,
    nodeVersion: '24.18.0',
    // A test that serves its own default registry is about that registry. With
    // no bundled copy to compare revisions with, the one served is read.
    ...(overrides.defaultRegistry && !overrides.bundledRegistryDir
      ? { bundledRegistryDir: join(tmp(), 'no-bundled-copy') }
      : {}),
    ...overrides,
  })
  return {
    code,
    stdout: stripVTControlCharacters(stdout),
    stderr: stripVTControlCharacters(stderr),
  }
}
