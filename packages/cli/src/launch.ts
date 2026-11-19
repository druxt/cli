// Read by the binary on any Node, so it uses only what an old Node has.
import { spawn, type StdioOptions } from 'node:child_process'
import { findNewerNode } from './find-node.js'
import { nodeTooOld } from './node-version.js'

export interface Launch {
  /** The version of the Node that is running. */
  node: string
  argv: string[]
  /** The path this binary was started as. */
  script: string
  env: Record<string, string | undefined>
  home: string
  /** The path of the Node that is running. */
  current: string
  stderr: { write(text: string): unknown }
  stdout: { write(text: string): unknown }
  /** Runs the command on this Node. Loaded only when this Node is new enough. */
  run: (argv: string[]) => Promise<number>
  stdio?: StdioOptions
  /** Directories of binaries that a system install puts Node in. */
  system?: string[]
}

/**
 * Reports a failure of the launcher itself. No command ran, so with `--json`
 * the one JSON document on stdout is this error.
 */
function fail(options: Launch, message: string): number {
  if (options.argv.includes('--json')) {
    options.stdout.write(
      `${JSON.stringify({ ok: false, error: { code: 'node', message } }, null, 2)}\n`
    )
  }
  options.stderr.write(`Error: ${message}\n`)
  return 1
}

/**
 * Runs a command and returns its exit code.
 *
 * A site can pin an older Node than drx runs on, and a version manager
 * switches to it in the site's directory. On such a Node the command is run
 * again on a newer Node from this machine. The tools the command starts, such
 * as the site's package manager, still come from the user's own PATH.
 */
export async function launch(options: Launch): Promise<number> {
  const problem = nodeTooOld(options.node)
  if (!problem) return options.run(options.argv)

  const newer = options.env.DRX_RELAUNCHED
    ? undefined
    : findNewerNode({
        env: options.env,
        script: options.script,
        home: options.home,
        current: options.current,
        ...(options.system ? { system: options.system } : {}),
      })
  if (!newer) {
    return fail(
      options,
      `${problem}\nNo newer Node was found on this machine. Install one, or set DRX_NODE to the path of its node binary.`
    )
  }

  return new Promise<number>((resolve) => {
    const child = spawn(newer, [options.script, ...options.argv], {
      stdio: options.stdio ?? 'inherit',
      // The Node the user's shell is on, which is the one their site runs on.
      env: { ...options.env, DRX_RELAUNCHED: options.node },
    })
    child.on('error', (error) => {
      resolve(
        fail(
          options,
          `${problem}\n${newer} could not be started: ${error.message}`
        )
      )
    })
    child.on('close', (code) => resolve(code === null ? 1 : code))
  })
}

/** What `launchProcess` reads from the running process. */
export interface RunningProcess {
  versions: { node: string }
  argv: string[]
  env: Record<string, string | undefined>
  execPath: string
  stderr: { write(text: string): unknown }
  stdout: { write(text: string): unknown }
}

/**
 * Launches a binary from the process it was started in. The command is the
 * named export of a module, which is loaded only on a Node that is new enough.
 */
export function launchProcess(
  running: RunningProcess,
  home: string,
  module: string,
  name: string
): Promise<number> {
  return launch({
    node: running.versions.node,
    argv: running.argv.slice(2),
    script: running.argv[1] ?? '',
    env: running.env,
    home,
    current: running.execPath,
    stderr: running.stderr,
    stdout: running.stdout,
    run: async (argv) => {
      const loaded = (await import(module)) as Record<
        string,
        (argv: string[]) => Promise<number>
      >
      return loaded[name]!(argv)
    },
  })
}
