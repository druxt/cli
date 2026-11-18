import { accessSync, constants, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

type Env = Record<string, string | undefined>

/** The extensions Windows tries when PATHEXT is not set. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/** A name a registry entry may ask to be looked up: no path, no spaces. */
export function isCommandName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._+-]*$/i.test(value)
}

function isRunnable(file: string, windows: boolean): boolean {
  try {
    if (!statSync(file).isFile()) return false
    // Windows decides by extension, and has no executable bit to read.
    if (!windows) accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** A name as Windows would try it: as it is, or with each extension. */
function spellings(name: string, env: Env, windows: boolean): string[] {
  if (!windows || extname(name) !== '') return [name]
  return (
    (env.PATHEXT || DEFAULT_PATHEXT)
      .split(';')
      .filter(Boolean)
      // The file system ignores case there. Trying the lower-case spelling
      // first gives the same answer on one that does not.
      .flatMap((extension) => [extension.toLowerCase(), extension])
      .map((extension) => name + extension)
  )
}

/**
 * The file a command name resolves to on PATH, or undefined. It reads the
 * directories itself and runs nothing, so no shell is involved.
 *
 * On Windows the variable may be spelled `Path`, the separator is `;`, and a
 * name with no extension is tried with each extension in PATHEXT.
 */
export function findOnPath(
  name: string,
  env: Env = process.env,
  platform: string = process.platform
): string | undefined {
  const windows = platform === 'win32'
  const key = windows
    ? Object.keys(env).find((candidate) => candidate.toUpperCase() === 'PATH')
    : 'PATH'
  const directories = (env[key ?? 'PATH'] ?? '')
    .split(windows ? ';' : ':')
    .filter(Boolean)

  const names = spellings(name, env, windows)
  for (const directory of directories) {
    for (const candidate of names) {
      const file = join(directory, candidate)
      if (isRunnable(file, windows)) return file
    }
  }
  return undefined
}

/**
 * The file a command would start: a name is looked up on PATH, and a path
 * is taken from the directory the command runs in. On Windows a path with
 * no extension is tried with each extension in PATHEXT, as a name is.
 */
export function findCommandFile(
  command: string,
  cwd: string,
  env: Env = process.env,
  platform: string = process.platform
): string | undefined {
  if (!/[\\/]/.test(command)) return findOnPath(command, env, platform)
  const windows = platform === 'win32'
  return spellings(resolve(cwd, command), env, windows).find((file) =>
    isRunnable(file, windows)
  )
}

/** What a starter's commands look like on this machine. */
export interface CommandCheck {
  /** True when every command of at least one alternative was found. */
  satisfied: boolean
  /** The alternatives, as the registry entry gives them. */
  alternatives: string[][]
  found: string[]
  missing: string[]
}

/**
 * Looks up every command of every alternative, each once, in the order the
 * entry names them.
 */
export function checkCommands(
  alternatives: string[][],
  find: (name: string) => string | undefined
): CommandCheck {
  const present = new Map<string, boolean>()
  for (const name of alternatives.flat()) {
    if (!present.has(name)) present.set(name, find(name) !== undefined)
  }
  const names = [...present.keys()]
  return {
    satisfied: alternatives.some((commands) =>
      commands.every((name) => present.get(name))
    ),
    alternatives,
    found: names.filter((name) => present.get(name)),
    missing: names.filter((name) => !present.get(name)),
  }
}

/** The alternatives as a phrase: "one and two, or three". */
export function describeAlternatives(alternatives: string[][]): string {
  return alternatives
    .map((commands) =>
      commands.length > 1
        ? `${commands.slice(0, -1).join(', ')} and ${commands.at(-1)}`
        : (commands[0] ?? '')
    )
    .join(', or ')
}
