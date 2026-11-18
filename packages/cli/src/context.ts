import { downloadTemplate } from 'giget'
import { installDependencies } from './install.js'
import { bundledRegistryDir } from './package-root.js'
import { terminalPrompter } from './prompts.js'
import { DEFAULT_REGISTRY } from './registry/registry.js'

/** The part of a stream the CLI writes to. */
export interface TextStream {
  write(chunk: string): unknown
  isTTY?: boolean
}

export interface Choice<T extends string> {
  value: T
  label: string
  hint?: string
}

/** The questions a command may ask a person at the terminal. */
export interface Prompter {
  text(question: { message: string; initial?: string }): Promise<string>
  select<T extends string>(question: {
    message: string
    choices: Choice<T>[]
    initial?: T
  }): Promise<T>
  confirm(question: { message: string; initial: boolean }): Promise<boolean>
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
  now: () => Date
  fetch: typeof fetch
  prompter: Prompter
  /** The registry used when `--registry` is not given. */
  defaultRegistry: string
  /** The copy of the registry used when the default cannot be read. */
  bundledRegistryDir: string
  /** Fetches and unpacks a template. giget's `downloadTemplate`. */
  download: typeof downloadTemplate
  /** Installs the dependencies of the site in a directory. */
  install: (dir: string) => Promise<void>
}

export function defaultContext(): CliContext {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    nodeVersion: process.versions.node,
    now: () => new Date(),
    fetch: globalThis.fetch,
    prompter: terminalPrompter(),
    defaultRegistry: DEFAULT_REGISTRY,
    bundledRegistryDir: bundledRegistryDir(),
    download: downloadTemplate,
    install: (dir) => installDependencies(dir),
  }
}
