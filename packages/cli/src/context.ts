import { downloadTemplate } from 'giget'
import { findOnPath } from './commands-on-path.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installDependencies } from './install.js'
import { DEFAULT_MODULE_REGISTRY } from './modules/registry.js'
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
  /** The module registry used when `--module-registry` is not given. */
  defaultModuleRegistry: string
  /** The directory the CLI keeps what it can fetch again in. */
  cacheDir: string
  /** Fetches and unpacks a template. giget's `downloadTemplate`. */
  download: typeof downloadTemplate
  /** Installs the dependencies of the site in a directory. */
  install: (dir: string) => Promise<void>
  /** The file a command name resolves to on PATH, or undefined. */
  findCommand: (name: string) => string | undefined
  /**
   * Set by a binary that runs one command under a name of its own, so the
   * usage of that command is headed by the name the user typed.
   */
  startedAs?: { command: string; name: string }
}

/**
 * `DRX_CACHE_DIR`, or `drx` under the user's cache directory.
 */
export function cacheDirectory(
  env: Record<string, string | undefined>
): string {
  if (env.DRX_CACHE_DIR) return env.DRX_CACHE_DIR
  const base = env.XDG_CACHE_HOME ?? join(env.HOME ?? homedir(), '.cache')
  return join(base, 'drx')
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
    defaultModuleRegistry: DEFAULT_MODULE_REGISTRY,
    cacheDir: cacheDirectory(process.env),
    download: downloadTemplate,
    install: (dir) => installDependencies(dir),
    findCommand: (name) => findOnPath(name),
  }
}
