/** The part of a stream the CLI writes to. */
export interface TextStream {
  write(chunk: string): unknown
  isTTY?: boolean
}

/**
 * Everything a command takes from the process it runs in. The tests pass
 * their own, so no command reads `process` directly.
 */
export interface CliContext {
  cwd: string
  env: Record<string, string | undefined>
  /** The result of a command: its text, or its JSON with `--json`. */
  stdout: TextStream
  /** Progress, warnings, errors and prompts. */
  stderr: TextStream
  /** True when a person is at the terminal to answer a prompt. */
  interactive: boolean
  /** The running Node version, without the leading `v`. */
  nodeVersion: string
}

export function defaultContext(): CliContext {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    nodeVersion: process.versions.node,
  }
}
